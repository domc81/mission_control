import React from "react";
import ReactDOM from "react-dom/client";
import MissionControl from "./MissionControl";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

root.render(
  <React.StrictMode>
    <MissionControl />
  </React.StrictMode>
);
