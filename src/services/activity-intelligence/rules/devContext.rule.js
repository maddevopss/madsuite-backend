const devContextRule = {
  evaluate: (context) => {
    const { currentClassification, openWindows } = context;
    if (!openWindows || openWindows.length === 0) return null;

    const text = openWindows
      .map((win) => `${win.app_name || win.ProcessName || ""} ${win.window_title || win.MainWindowTitle || ""}`)
      .join(" ")
      .toLowerCase();
      
    const hasCode = /code|visual studio|cursor|webstorm|intellij|pycharm|goland/.test(text);
    const hasTerminal = /terminal|powershell|cmd|bash|wsl/.test(text);
    const hasDevBrowser = /localhost|127\.0\.0\.1|github|gitlab|jira|linear|stackoverflow/.test(text);

    if (hasCode && hasTerminal && hasDevBrowser) {
      return {
        ...currentClassification,
        category: "Développement",
        tag: "session-dev",
        confidence: Math.max(Number(currentClassification.confidence || 0), 92),
        context: "VS Code + Terminal + navigateur dev détectés",
      };
    }
    
    return null;
  }
};

module.exports = devContextRule;
