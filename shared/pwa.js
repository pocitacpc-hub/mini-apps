(() => {
  if ("serviceWorker" in navigator) {
    const workerUrl = new URL("../sw.js", document.currentScript.src);
    navigator.serviceWorker.register(workerUrl).catch(error => {
      console.warn("Nepodařilo se zapnout offline režim Mini Apps.", error);
    });
  }

  const installButton = document.getElementById("installApp");
  if (!installButton) return;

  let installPrompt;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = undefined;
    installButton.hidden = true;
    try {
      await prompt.prompt();
    } catch (error) {
      console.warn("Nepodařilo se otevřít instalaci Mini Apps.", error);
    }
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = undefined;
    installButton.hidden = true;
  });
})();
