import { useState } from "react";
import { ApplicationShell } from "./features/workspace/ApplicationShell";
import { Login } from "./features/login/Login";
import "./features/preferences/i18n";
import "./styles/theme.css";

export default function App() {
  const [demo, setDemo] = useState(false);
  return <>
    {!demo && <Login onDemo={() => setDemo(true)} />}
    <div hidden={!demo}><ApplicationShell onLogin={() => setDemo(false)} /></div>
  </>;
}
