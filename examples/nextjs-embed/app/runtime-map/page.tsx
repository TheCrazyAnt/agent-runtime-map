import { RuntimeMapPanel } from "./RuntimeMapPanel";

export const metadata = { title: "Runtime Map" };

export default function RuntimeMapPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Agent Runtime Map</h1>
      <RuntimeMapPanel />
    </main>
  );
}
