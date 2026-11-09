import { L, T } from "../components/ui";

export function NotFound() {
  return (
    <div className="card">
      <h1><T k="notFound" /></h1>
      <p><L to="/"><T k="home" /></L></p>
    </div>
  );
}
