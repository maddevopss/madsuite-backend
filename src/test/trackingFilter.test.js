const { shouldIgnoreActivity, getActivitySignature, isPrivacySensitiveTitle } = require("../utils/trackingFilter");

describe("trackingFilter", () => {
  describe("shouldIgnoreActivity", () => {
    test("ignore null/undefined app_name et window_title", () => {
      expect(shouldIgnoreActivity({ app_name: null, window_title: null })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "", window_title: "" })).toBe(true);
      expect(shouldIgnoreActivity({})).toBe(true);
    });

    test("ignore les apps dans IGNORED_APPS", () => {
      expect(shouldIgnoreActivity({ app_name: "Electron", window_title: "foo" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "MADSUITE", window_title: "bar" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "applicationframehost", window_title: "baz" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "PowerToys.QuickAccess", window_title: "qux" })).toBe(true);
    });

    test("ignore les titres dans IGNORED_TITLES", () => {
      expect(shouldIgnoreActivity({ app_name: "Chrome", window_title: "Paramètres" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "Chrome", window_title: "Developer Tools" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "Code", window_title: "Settings" })).toBe(true);
    });

    test("ignore les titres sensibles vie privee", () => {
      expect(shouldIgnoreActivity({ app_name: "Chrome", window_title: "Entrez votre mot de passe" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "Firefox", window_title: "Password reset" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "Safari", window_title: "Credit Card Details" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "App", window_title: "carte bancaire" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "App", window_title: "Confidential Document" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "App", window_title: "SSN: 123-45-6789" })).toBe(true);
    });

    test("ignore window_title vide", () => {
      expect(shouldIgnoreActivity({ app_name: "Chrome", window_title: "" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "Chrome", window_title: "   " })).toBe(true);
    });

    test("accepte une activite normale", () => {
      expect(shouldIgnoreActivity({ app_name: "Chrome", window_title: "GitHub" })).toBe(false);
      expect(shouldIgnoreActivity({ app_name: "VSCode", window_title: "index.js" })).toBe(false);
      expect(shouldIgnoreActivity({ app_name: "Slack", window_title: "#general" })).toBe(false);
    });

    test("case insensitive pour les apps", () => {
      expect(shouldIgnoreActivity({ app_name: "electron", window_title: "foo" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "MADSUITE", window_title: "bar" })).toBe(true);
    });

    test("case insensitive pour les titres ignores", () => {
      expect(shouldIgnoreActivity({ app_name: "Chrome", window_title: "PARAMETRES" })).toBe(true);
      expect(shouldIgnoreActivity({ app_name: "Chrome", window_title: "developer tools" })).toBe(true);
    });
  });

  describe("getActivitySignature", () => {
    test("genere une signature stable app::title", () => {
      const sig1 = getActivitySignature({ app_name: "Chrome", window_title: "GitHub" });
      const sig2 = getActivitySignature({ app_name: "Chrome", window_title: "GitHub" });

      expect(sig1).toBe("Chrome::GitHub");
      expect(sig1).toBe(sig2);
    });

    test("signatures differentes pour apps ou titres differents", () => {
      const sig1 = getActivitySignature({ app_name: "Chrome", window_title: "GitHub" });
      const sig2 = getActivitySignature({ app_name: "Chrome", window_title: "GitLab" });
      const sig3 = getActivitySignature({ app_name: "Firefox", window_title: "GitHub" });

      expect(sig1).not.toBe(sig2);
      expect(sig1).not.toBe(sig3);
    });

    test("gere les valeurs nulles", () => {
      expect(getActivitySignature({ app_name: null, window_title: null })).toBe("::");
      expect(getActivitySignature({ app_name: "Chrome" })).toBe("Chrome::");
    });
  });

  describe("isPrivacySensitiveTitle", () => {
    test("detecte les mots de passe", () => {
      expect(isPrivacySensitiveTitle("Entrez votre mot de passe")).toBe(true);
      expect(isPrivacySensitiveTitle("Password")).toBe(true);
      expect(isPrivacySensitiveTitle("Mot de passe")).toBe(true);
    });

    test("detecte les autres patterns RGPD", () => {
      expect(isPrivacySensitiveTitle("Credit Card Form")).toBe(true);
      expect(isPrivacySensitiveTitle("carte bancaire")).toBe(true);
      expect(isPrivacySensitiveTitle("SSN: 123")).toBe(true);
      expect(isPrivacySensitiveTitle("Social Security Number")).toBe(true);
      expect(isPrivacySensitiveTitle("Confidential")).toBe(true);
    });

    test("ne detecte pas les titres normaux", () => {
      expect(isPrivacySensitiveTitle("GitHub")).toBe(false);
      expect(isPrivacySensitiveTitle("Slack - #general")).toBe(false);
      expect(isPrivacySensitiveTitle("VSCode index.js")).toBe(false);
    });
  });
});
