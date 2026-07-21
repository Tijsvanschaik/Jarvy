import React from "react";
import ReactDOM from "react-dom/client";
import { OperatorPanel } from "./operator/OperatorPanel";
import "./operator/operator.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OperatorPanel />
  </React.StrictMode>,
);
