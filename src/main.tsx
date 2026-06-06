import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Reset de estilos base
const style = document.createElement("style");
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  input, button, textarea { font-family: inherit; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
