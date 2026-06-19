const PRODUCTIVE_APPS = ["code", "visual studio", "postman", "pgadmin", "terminal", "powershell", "cmd", "github"];
const DISTRACTION_APPS = ["discord", "youtube", "netflix", "twitch", "steam", "game", "spotify"];

function classifyApp(appName = "") {
  const name = appName.toLowerCase();

  if (PRODUCTIVE_APPS.some((app) => name.includes(app))) return "productif";
  if (DISTRACTION_APPS.some((app) => name.includes(app))) return "distraction";

  return "neutre";
}

module.exports = {
  classifyApp,
};
