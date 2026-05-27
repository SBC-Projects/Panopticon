import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { installInspectClickRouter } from "./lib/inspectClickRouter";

installInspectClickRouter();

mount(App, { target: document.getElementById("app")! });
