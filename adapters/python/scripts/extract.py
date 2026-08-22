"""Extracts structural facts from Python sources for Agent Runtime Map.

This parses with the standard library `ast` module and never executes the code it
reads: `ast.parse` builds a tree, it does not import or run anything. It also makes
no product judgements. It reports what is written — definitions, calls, imports,
decorators, string constants — and the TypeScript side decides what any of it means,
so the classification rules stay in one language rather than drifting across two.

Input:  a JSON array of absolute file paths on stdin.
Output: a JSON object of facts on stdout.
"""

import ast
import json
import sys


def literal(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts = [p.value for p in node.values if isinstance(p, ast.Constant) and isinstance(p.value, str)]
        return "".join(parts) if parts else None
    return None


def dotted_name(node):
    """`a.b.c` and `a.b.c()` both reduce to the text a reader would recognise."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Call):
        return dotted_name(node.func)
    return None


def keyword_map(call):
    """Named arguments, which is how every Agent framework configures a construct."""
    out = {}
    for kw in call.keywords:
        if kw.arg is None:
            continue
        text = literal(kw.value)
        if text is not None:
            out[kw.arg] = {"kind": "string", "value": text[:4000]}
        else:
            names = [n for n in (dotted_name(e) for e in flatten(kw.value)) if n]
            out[kw.arg] = {"kind": "names", "value": names[:24]}
    return out


def flatten(node):
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return list(node.elts)
    if isinstance(node, ast.Dict):
        return [v for v in node.values]
    return [node]


def end_line(node):
    return getattr(node, "end_lineno", None) or node.lineno


class FileVisitor(ast.NodeVisitor):
    def __init__(self, path):
        self.path = path
        self.functions = []
        self.classes = []
        self.assignments = []
        self.imports = []
        self.calls = []
        self._scope = []

    # A scope stack is what lets a call be attributed to the definition it sits in.
    def _push(self, name, kind, node, enclosing_class):
        decorators = [d for d in (dotted_name(x) for x in node.decorator_list) if d]
        record = {
            "name": name,
            "kind": kind,
            "line": node.lineno,
            "endLine": end_line(node),
            "enclosingClass": enclosing_class,
            "decorators": decorators,
            "isAsync": isinstance(node, ast.AsyncFunctionDef),
            "docstring": (ast.get_docstring(node) or "")[:2000],
            "parameters": [a.arg for a in node.args.args],
            "returns": dotted_name(node.returns) if node.returns else None,
            "branches": 0,
            "loops": 0,
            "catches": 0,
        }
        for child in ast.walk(node):
            if isinstance(child, (ast.If, ast.IfExp, ast.Match)):
                record["branches"] += 1
            elif isinstance(child, (ast.For, ast.AsyncFor, ast.While)):
                record["loops"] += 1
            elif isinstance(child, ast.ExceptHandler):
                record["catches"] += 1
        self.functions.append(record)
        return record

    def _visit_function(self, node):
        enclosing = self._scope[-1]["name"] if self._scope and self._scope[-1]["kind"] == "class" else None
        record = self._push(node.name, "function", node, enclosing)
        self._scope.append({"name": node.name, "kind": "function", "record": record})
        self.generic_visit(node)
        self._scope.pop()

    visit_FunctionDef = _visit_function
    visit_AsyncFunctionDef = _visit_function

    def visit_ClassDef(self, node):
        self.classes.append({
            "name": node.name,
            "line": node.lineno,
            "endLine": end_line(node),
            "bases": [b for b in (dotted_name(x) for x in node.bases) if b],
            "decorators": [d for d in (dotted_name(x) for x in node.decorator_list) if d],
            "docstring": (ast.get_docstring(node) or "")[:2000],
        })
        self._scope.append({"name": node.name, "kind": "class", "record": None})
        self.generic_visit(node)
        self._scope.pop()

    def visit_Assign(self, node):
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            self._record_assignment(node.targets[0].id, node.value, node)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        if isinstance(node.target, ast.Name) and node.value is not None:
            self._record_assignment(node.target.id, node.value, node)
        self.generic_visit(node)

    def _record_assignment(self, name, value, node):
        text = literal(value)
        call = value if isinstance(value, ast.Call) else None
        if isinstance(value, ast.Await) and isinstance(value.value, ast.Call):
            call = value.value
        self.assignments.append({
            "name": name,
            "line": node.lineno,
            "endLine": end_line(node),
            "scope": self._scope[-1]["name"] if self._scope else None,
            "text": text[:4000] if text else None,
            "factory": dotted_name(call.func) if call else None,
            "options": keyword_map(call) if call else {},
            "elements": [n for n in (dotted_name(e) for e in flatten(value)) if n] if isinstance(value, (ast.List, ast.Tuple)) else [],
        })

    def visit_Import(self, node):
        for alias in node.names:
            self.imports.append({"module": alias.name, "name": None, "alias": alias.asname, "line": node.lineno})
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        for alias in node.names:
            self.imports.append({
                "module": node.module or "",
                "name": alias.name,
                "alias": alias.asname,
                "level": node.level,
                "line": node.lineno,
            })
        self.generic_visit(node)

    def visit_Call(self, node):
        callee = dotted_name(node.func)
        if callee:
            enclosing = None
            for frame in reversed(self._scope):
                if frame["kind"] == "function":
                    enclosing = frame["name"]
                    break
            self.calls.append({
                "callee": callee,
                "line": node.lineno,
                "enclosingFunction": enclosing,
                "enclosingClass": next((f["name"] for f in reversed(self._scope) if f["kind"] == "class"), None),
                "stringArguments": [a for a in (literal(x) for x in node.args) if a is not None][:4],
                "nameArguments": [n for n in (dotted_name(a) for a in node.args) if n][:8],
                "options": keyword_map(node),
            })
        self.generic_visit(node)


def analyze(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            source = handle.read()
    except OSError as error:
        return {"path": path, "error": f"unreadable: {error}"}
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as error:
        # A file the interpreter itself cannot parse is reported, not guessed at.
        return {"path": path, "error": f"syntax error on line {error.lineno}"}
    visitor = FileVisitor(path)
    visitor.visit(tree)
    return {
        "path": path,
        "docstring": (ast.get_docstring(tree) or "")[:2000],
        "functions": visitor.functions,
        "classes": visitor.classes,
        "assignments": visitor.assignments,
        "imports": visitor.imports,
        "calls": visitor.calls,
    }


def main():
    paths = json.load(sys.stdin)
    json.dump({"pythonVersion": sys.version.split()[0], "files": [analyze(p) for p in paths]}, sys.stdout)


if __name__ == "__main__":
    main()
