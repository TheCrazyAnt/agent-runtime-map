/**
 * The shape the bundled extractor emits. These describe Python syntax and stop here:
 * nothing in this file reaches the Raw Code Graph, which is how the Viewer protocol
 * stays free of Python-specific structures.
 */

export interface PythonOptionValue {
  kind: "string" | "names";
  value: string & string[];
}

export type PythonOptions = Record<string, { kind: "string"; value: string } | { kind: "names"; value: string[] }>;

export interface PythonFunction {
  name: string;
  line: number;
  endLine: number;
  enclosingClass: string | null;
  decorators: string[];
  isAsync: boolean;
  docstring: string;
  parameters: string[];
  returns: string | null;
  branches: number;
  loops: number;
  catches: number;
}

export interface PythonClass {
  name: string;
  line: number;
  endLine: number;
  bases: string[];
  decorators: string[];
  docstring: string;
}

export interface PythonAssignment {
  name: string;
  line: number;
  endLine: number;
  scope: string | null;
  text: string | null;
  factory: string | null;
  options: PythonOptions;
  elements: string[];
}

export interface PythonImport {
  module: string;
  name: string | null;
  alias: string | null;
  level?: number;
  line: number;
}

export interface PythonCall {
  callee: string;
  line: number;
  enclosingFunction: string | null;
  enclosingClass: string | null;
  stringArguments: string[];
  nameArguments: string[];
  options: PythonOptions;
}

export interface PythonFile {
  path: string;
  error?: string;
  docstring: string;
  functions: PythonFunction[];
  classes: PythonClass[];
  assignments: PythonAssignment[];
  imports: PythonImport[];
  calls: PythonCall[];
}

export interface PythonFacts {
  pythonVersion: string;
  files: PythonFile[];
}
