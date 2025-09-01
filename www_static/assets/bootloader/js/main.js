import { ResourceLoader } from "./modules/resource_loader.js";
import { utils } from "./modules/utils.js";
import { Config } from "./modules/config.js";
import { LOADING_QUOTES } from "./modules/quotes.js";
import { shim } from "./modules/shim.js";

class Bootloader {
  constructor() {
    this.loader = new ResourceLoader();
    window.__require = window.require;
    window.__OVERLAY__ = window.overlay != null;
    window.cdn_url = Config.cdn_url;
    window.release_date = utils.getReleaseDate();
    this.release_date = window.release_date;
    this.originalBuild = utils.getOriginalBuild();
    this.localStorage = window.localStorage;

    this.originalChildren = [...document.body.children];
    this.setLoadingBackground();
    this.showRandomQuote();

    this.progressBar = document.getElementById("oldcord-loading-progress");
    this.progressInner = document.getElementById(
      "oldcord-loading-progress-inner"
    );
  }

  getYearFromRelease(release) {
    const year = release.split("_")[2];
    return year;
  }

  showRandomQuote() {
    const year = this.getYearFromRelease(this.release_date);
    const randomQuote =
      LOADING_QUOTES[Math.floor(Math.random() * LOADING_QUOTES.length)];
    const quoteText = randomQuote.text.replace(/\{year\}/g, year);

    document.getElementById("oldcord-loading-quote").textContent = quoteText;

    const submitter = document.getElementById("oldcord-loading-submitter");
    if (randomQuote.submittedBy) {
      const submitterText = randomQuote.submittedVia
        ? `SUBMITTED BY <span>${randomQuote.submittedBy}</span> VIA <span>${randomQuote.submittedVia}</span>`
        : `SUBMITTED BY <span>${randomQuote.submittedBy}</span>`;
      submitter.innerHTML = submitterText;
      submitter.style.display = "block";
    } else {
      submitter.style.display = "none";
    }
  }

  setLoadingText(text) {
    const loadingElement = document.getElementById("oldcord-loading-text");
    if (loadingElement) loadingElement.textContent = text;
  }

  setProgress(current, total, show = true) {
    if (show) {
      this.progressBar.classList.add("active");
      const percent = (current / total) * 100;
      this.progressInner.style.width = `${percent}%`;
    } else {
      this.progressBar.classList.remove("active");
    }
  }

  async initialize() {
    try {
      // Clean up invalid tokens
      const token = this.localStorage?.getItem("token");
      if (token === "null" || token === "undefined") {
        this.localStorage.removeItem("token");
      }

      utils.loadLog("Build: " + this.release_date);
      utils.loadLog("Loading instance config...");
      window.config = await Config.load();
      document.title = window.config.instance.name;

      const envCheck = await this.checkEnvironment();
      if (envCheck.status === "ready") {
        await this.loadApplication();
      } else if (envCheck.status === "temp_build") {
        await utils.timer(3000);
        window.location.href = window.location.href;
      }
    } catch (e) {
      utils.loadLog("Fatal error occurred. Please check the console.", "error");
      throw e;
    }
  }

  async checkEnvironment() {
    if (window.DiscordNative && this.release_date === "april_1_2018") {
      utils.loadLog("This build does not work on desktop client.", "error");
      await utils.timer(3000);
      window.location.replace("/selector");
      return { status: "fatal" };
    }

    const needsTempBuild = this.checkLoginCompatibility();
    if (needsTempBuild) {
      return { status: "temp_build" };
    }

    window.BetterDiscord = true;
    window.Firebug = { chrome: { isInitialized: false } };
    window.GLOBAL_ENV = window.config.globalEnv;
    return { status: "ready" };
  }

  checkLoginCompatibility() {
    let hasToken = false;
    try {
      hasToken = Boolean(window.localStorage?.getItem("token"));
    } catch {
      return false;
    }

    if (hasToken) return false;

    const brokenBuilds = [
      "november_16_2017",
      "december_21_2017",
      "january_27_2018",
      "march_7_2018",
      "april_1_2018",
      "april_23_2018",
    ];

    // Check if current build is either broken login or no captcha build
    const hasLoginIssues =
      brokenBuilds.includes(this.release_date) ||
      this.release_date.endsWith("_2015") ||
      this.release_date.endsWith("_2016");

    if (hasLoginIssues) {
      utils.loadLog(
        `Warning: Login issues detected in the build you're trying to use. Switching to February 25 2018 temporarily...`,
        "warning"
      );
      this.originalBuild = this.release_date;
      utils.setCookie("original_build", this.originalBuild);
      this.release_date = window.release_date = "february_25_2018";
      utils.setCookie("release_date", "february_25_2018");
      return true;
    }
    return false;
  }

  startTokenMonitor() {
    utils.loadLog("Starting token monitor...", "warning");

    // Workaround for Discord's monkey patching of localStorage
    this.storageFrame = document.body.appendChild(
      document.createElement("iframe")
    );
    this.localStorage = this.storageFrame.contentWindow.localStorage;

    return setInterval(() => {
      try {
        if (this.checkForToken()) {
          this.handleLoginDetected();
        }
      } catch (e) {
        utils.loadLog("Error in token monitor: " + e, "error");
      }
    }, 100);
  }

  checkForToken() {
    try {
      return Boolean(this.localStorage?.token);
    } catch (e) {
      utils.loadLog("Token check error: " + e, "error");
      return false;
    }
  }

  handleLoginDetected() {
    utils.loadLog(
      "Token detected! Switching back to: " + this.originalBuild,
      "warning"
    );
    // Clean up the iframe before reload
    this.storageFrame?.remove();

    this.release_date = window.release_date = this.originalBuild;
    utils.setCookie("release_date", this.originalBuild);
    utils.removeCookie("original_build");

    window.location.href = window.location.pathname;
  }

  async loadApplication() {
    // Set up chunk loading progress tracking first
    this.loader.onChunkProgress = (current, total, type) => {
      if (type === "find") {
        this.setLoadingText(`DETERMINING CHUNKS (${current}/${total})`);
      } else if (type === "load") {
        this.setLoadingText(
          `LOADING AND PATCHING CHUNKS (${current}/${total})`
        );
      }
      this.setProgress(current, total);
    };

    this.setLoadingText("DOWNLOADING APPLICATION");
    const html = await this.fetchAppHtml();

    const { head, body } = this.parseHtml(html);
    const [styleUrls, scriptUrls] = this.extractResourceUrls(head, body);

    const totalFiles = styleUrls.length + scriptUrls.length;
    let loadedFiles = 0;
    this.setLoadingText(`DOWNLOADING CSS AND JS FILES (0/${totalFiles})`);
    this.setProgress(0, totalFiles);

    const styles = await Promise.all(
      styleUrls.map(async (url) => {
        const result = await this.loader.loadCSS(url);
        loadedFiles++;
        this.setLoadingText(
          `DOWNLOADING CSS AND JS FILES (${loadedFiles}/${totalFiles})`
        );
        this.setProgress(loadedFiles, totalFiles);
        return result;
      })
    );

    const scripts = [];
    for (const url of scriptUrls) {
      const result = await this.loader.loadScript(url);
      if (result) scripts.push(result);
      loadedFiles++;
      this.setLoadingText(
        `DOWNLOADING CSS AND JS FILES (${loadedFiles}/${totalFiles})`
      );
      this.setProgress(loadedFiles, totalFiles);
    }

    this.setupDOM(head, body, styles, scripts);
    this.setupResourceInterceptor();

    shim();

    this.setProgress(0, 1, false);
    this.setLoadingText("READY");
    await utils.timer(1000);

    await this.executeScripts();
    await this.waitForMount();
    this.originalBuild && this.startTokenMonitor();
    this.startHeadCleanup();
  }

  extractResourceUrls(head, body) {
    const getUrls = (regex) =>
      [...(head + body).matchAll(regex)]
        .map((m) => m[1])
        .filter((url) => url.startsWith("/"));

    const styleUrls = getUrls(/<link[^>]+href="([^"]+)"[^>]*>/g).filter(
      (url) => !url.endsWith(".ico")
    );
    const scriptUrls = getUrls(/<script[^>]+src="([^"]+)"[^>]*>/g);

    return [styleUrls, scriptUrls];
  }

  setupDOM(head, body, styles, scripts) {
    this.currentHead = head;
    this.currentBody = body;

    // Create a document fragment for batch DOM updates
    const headFragment = document.createDocumentFragment();
    const bodyFragment = document.createDocumentFragment();

    const tempHead = document.createElement("div");
    tempHead.innerHTML = head;

    const styleMap = new Map(styles.map((s) => [s.url, s.blob]));
    const scriptMap = new Map(scripts.map((s) => [s.url, s.blob]));

    // Cache existing elements' attributes for faster comparison
    const existingElements = new Set();
    document.head.querySelectorAll("link, script").forEach((elem) => {
      existingElements.add(
        Array.from(elem.attributes)
          .map((a) => `${a.name}=${a.value}`)
          .sort()
          .join("|")
      );
    });

    for (const elem of [...tempHead.children]) {
      if (elem.tagName === "TITLE") continue;

      // Skip if element with same attributes already exists in document.head
      const elemAttrs = Array.from(elem.attributes)
        .map((a) => `${a.name}=${a.value}`)
        .sort()
        .join("|");
      const existingElem = [...document.head.children].some(
        (child) =>
          Array.from(child.attributes)
            .map((a) => `${a.name}=${a.value}`)
            .sort()
            .join("|") === elemAttrs
      );
      if (existingElem) continue;

      if (elem.tagName === "LINK" && elem.rel === "stylesheet") {
        const href = elem.getAttribute("href");
        const blob = Array.from(styleMap.keys()).find((url) =>
          url.includes(href)
        );
        if (blob) {
          elem.href = styleMap.get(blob);
          headFragment.appendChild(elem);
        }
        continue;
      }

      if (elem.tagName === "SCRIPT" && elem.src) {
        const src = elem.getAttribute("src");
        const blob = Array.from(scriptMap.keys()).find((url) =>
          url.includes(src)
        );
        if (blob) {
          elem.src = scriptMap.get(blob);
          headFragment.appendChild(elem);
        }
        continue;
      }

      headFragment.appendChild(elem);
    }

    const tempBody = document.createElement("div");
    tempBody.innerHTML = body;

    tempBody.querySelectorAll("script[src]").forEach((elem) => {
      const src = elem.getAttribute("src");
      const blob = Array.from(scriptMap.keys()).find((url) =>
        url.includes(src)
      );
      if (blob) {
        elem.src = scriptMap.get(blob);
      }
    });

    while (tempBody.firstChild) {
      bodyFragment.appendChild(tempBody.firstChild);
    }

    // Batch DOM updates
    document.head.appendChild(headFragment);
    document.body.appendChild(bodyFragment);
  }

  async waitForMount() {
    await new Promise((resolve) => {
      const check = setInterval(() => {
        const mount = document.getElementById("app-mount");
        if (mount?.children.length) {
          clearInterval(check);

          this.originalChildren.forEach((child) => child.remove());

          const loadingCss = document.querySelector(
            'link[href*="loading.css"]'
          );
          loadingCss?.remove();
          resolve();
        }
      }, 100);
    });
  }

  startHeadCleanup() {
    setInterval(() => {
      const seen = new Set();
      document.head.querySelectorAll("link, script").forEach((element) => {
        const attrs = Array.from(element.attributes)
          .map((attr) => `${attr.name}=${attr.value}`)
          .sort()
          .join("|");

        if (seen.has(attrs)) {
          element.remove();
        } else {
          seen.add(attrs);
        }
      });
    }, 1000);
  }

  async fetchAppHtml() {
    utils.loadLog("Downloading client files...");
    let html;
    try {
      if (window.location.href.includes("/developers")) {
        let dev_year = this.release_date.split("_")[2];

        if (
          isNaN(parseInt(dev_year)) ||
          parseInt(dev_year) <= 2017 ||
          parseInt(dev_year) > 2019
        ) {
          dev_year = "2018";
        }

        html = await (
          await fetch(
            `${cdn_url}/assets/clients/developers_${dev_year}/app.html`
          )
        ).text();
      } else
        html = await (
          await fetch(`${cdn_url}/assets/clients/${this.release_date}/app.html`)
        ).text();
    } catch (e) {
      utils.loadLog("Fatal error occurred. Please check the console.", "error");
      throw e;
    }
    return html;
  }

  parseHtml(html) {
    // Remove GLOBAL_ENV scripts
    html = html.replace(
      /<script(\s[^>]*)?>\s*window\.GLOBAL_ENV\s*=[\s\S]*?<\/script>/g,
      ""
    );

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    return { head: doc.head.innerHTML, body: doc.body.innerHTML };
  }

  async executeScripts() {
    const scriptElements = [...document.getElementsByTagName("script")].filter(
      (script) => script.src.startsWith("blob:")
    );

    for (const scriptElem of scriptElements) {
      await new Promise((resolve, reject) => {
        const blobUrl = scriptElem.src;
        const newScript = document.createElement("script");

        // Preserve attribute order by getting the original element's outerHTML
        const originalAttrs =
          scriptElem.outerHTML
            .match(/<script([^>]*)>/i)[1]
            .match(/\s+(?:[a-zA-Z-]+(?:=(?:"[^"]*"|'[^']*'|[^"'\s]+))?)/g) ||
          [];

        originalAttrs.forEach((attr) => {
          const [name, value] = attr.trim().split("=");
          const attrValue = value ? value.replace(/['"]/g, "") : "";
          newScript.setAttribute(name, name === "src" ? blobUrl : attrValue);
        });

        const appendTarget = scriptElem.closest("head")
          ? document.head
          : document.body;

        newScript.onload = () => {
          URL.revokeObjectURL(blobUrl);
          resolve();
        };
        newScript.onerror = reject;

        const nextSibling = scriptElem.nextSibling;
        scriptElem.remove();
        if (nextSibling) {
          appendTarget.insertBefore(newScript, nextSibling);
        } else {
          appendTarget.appendChild(newScript);
        }
      });
    }
  }

  isAfterBuild(currentBuild, compareBuild) {
    const parseDate = (build) => {
      const [month, day, year] = build.split("_");
      const months = {
        january: 0,
        february: 1,
        march: 2,
        april: 3,
        may: 4,
        june: 5,
        july: 6,
        august: 7,
        september: 8,
        october: 9,
        november: 10,
        december: 11,
      };
      return new Date(year, months[month], parseInt(day));
    };

    return parseDate(currentBuild) > parseDate(compareBuild);
  }

  setLoadingBackground() {
    const container = document.getElementById("oldcord-loading-container");
    if (container && this.isAfterBuild(this.release_date, "october_5_2017")) {
      setTimeout(() => container.classList.add("new-bg"), 50);
    }
  }

  setupResourceInterceptor() {
    this.loader.setupInterceptors();
  }
}

utils.loadLog("Initializing bootloader...");
new Bootloader().initialize().catch(console.error);
