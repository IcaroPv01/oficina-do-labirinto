import "./style.css";
import { mountApplication } from "./app";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Elemento #app não encontrado.");
}

void mountApplication(root);

