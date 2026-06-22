const meetingAdminRule = {
  evaluate: (context) => {
    const { currentClassification, openWindows } = context;
    if (!openWindows || openWindows.length === 0) return null;

    const text = openWindows
      .map((win) => `${win.app_name || win.ProcessName || ""} ${win.window_title || win.MainWindowTitle || ""}`)
      .join(" ")
      .toLowerCase();
      
    const hasMeeting = /teams|zoom|meet|slack/.test(text);
    const hasSpreadsheet = /excel|sheets/.test(text);

    if (hasMeeting && hasSpreadsheet) {
      return {
        ...currentClassification,
        category: "Administration / Rencontre",
        tag: "meeting-admin",
        confidence: Math.max(Number(currentClassification.confidence || 0), 82),
        context: "Rencontre + tableur détectés",
      };
    }
    
    return null;
  }
};

module.exports = meetingAdminRule;
