export type StartupStateStatus = "starting" | "ready" | "degraded";

type StartupState = {
  status: StartupStateStatus;
  detail: string;
  updatedAt: string;
};

let startupState: StartupState = {
  status: "starting",
  detail: "API runtime is still bootstrapping.",
  updatedAt: new Date().toISOString(),
};

function setStartupState(status: StartupStateStatus, detail: string) {
  startupState = {
    status,
    detail,
    updatedAt: new Date().toISOString(),
  };
}

export function markStartupStarting(detail = "API runtime is still bootstrapping.") {
  setStartupState("starting", detail);
}

export function markStartupReady(detail = "API runtime is ready.") {
  setStartupState("ready", detail);
}

export function markStartupDegraded(detail: string) {
  setStartupState("degraded", detail);
}

export function getStartupState(): StartupState {
  return startupState;
}
