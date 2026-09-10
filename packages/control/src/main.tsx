import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// No StrictMode: it double-mounts effects in dev, which would open two
// websocket connections and two render loops for the single Player.
createRoot(document.getElementById("root")!).render(<App />);
