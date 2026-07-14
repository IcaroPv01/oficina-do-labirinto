import "./style.css";
import { mountApplication } from "./app";
import { isStudioRoute } from "./studio/routing";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Elemento #app não encontrado.");
}

const pageUrl = new URL(window.location.href);

if (isStudioRoute(pageUrl)) {
  void import("./studio/application").then(({ mountStudioApplication }) =>
    mountStudioApplication(root),
  );
} else {
  void mountApplication(root);
}
