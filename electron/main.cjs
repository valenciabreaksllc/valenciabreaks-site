const { app, BrowserWindow, WebContentsView, ipcMain, shell, clipboard, session } = require("electron");
const path = require("path");

const DEV_URL = process.env.OP_DEV_SERVER_URL;

const LAYOUT = {
  top: 58,
  left: 214,
  right: 286,
  bottom: 50,
};

const LIVE_ROUTES = {
  zendesk: {
    label: "Command Inbox",
    url: "https://opcomicsgames.zendesk.com/agent/tickets",
    partition: "persist:op-zendesk",
  },
  usps: {
    label: "USPS Tracking",
    url: "https://tools.usps.com/go/TrackConfirmAction_input",
    partition: "persist:op-usps",
  },
};

const TIKTOK_RESEARCH = {
  ps: {
    label: "PokeSpins",
    url: "https://seller-us.tiktok.com/chat/inbox/current?oec_seller_id=7494390620994242403&shop_region=US&lang=en&from=seller_center_navigation_im",
    partition: "persist:op-pokespins-tiktok",
  },
  pm: {
    label: "PokieMart",
    url: "https://seller-us.tiktok.com/chat/inbox/current?from=seller_center_navigation_im&oec_seller_id=7494572492552308160&shop_region=US&lang=en",
    partition: "persist:op-pokiemart-tiktok",
  },
  ck: {
    label: "CardKing47",
    url: "https://seller-us.tiktok.com/chat/inbox/current?oec_seller_id=7496169249187334473&shop_region=US&lang=en&from=seller_center_navigation_im",
    partition: "persist:op-cardking47-tiktok",
  },
  vr: {
    label: "Vaulted Rarities",
    url: "https://seller-us.tiktok.com/chat/inbox/current?from=customer_enter_from_order_list&lang=en&oec_seller_id=7496129140166986165&shop_region=US&version=v2",
    partition: "persist:op-vaulted-tiktok",
  },
};

let win;
let activeRoute = "command";
const browserViews = new Map();
const routeStates = new Map();
const researchWindows = new Map();
let zendeskResearchWindow = null;

function getState(routeKey) {
  return routeStates.get(routeKey) || {
    title: LIVE_ROUTES[routeKey]?.label || "",
    url: LIVE_ROUTES[routeKey]?.url || "",
    loading: false,
    route: routeKey,
    error: null,
  };
}

function sendBrowserState(routeKey = activeRoute, extra = {}) {
  const previous = getState(routeKey);
  const next = { ...previous, ...extra, route: routeKey };
  routeStates.set(routeKey, next);
  if (routeKey === activeRoute && win && !win.isDestroyed()) {
    win.webContents.send("op:browser-state", next);
  }
}

function browserBounds() {
  const [width, height] = win.getContentSize();
  return {
    x: LAYOUT.left,
    y: LAYOUT.top,
    width: Math.max(320, width - LAYOUT.left - LAYOUT.right),
    height: Math.max(240, height - LAYOUT.top - LAYOUT.bottom),
  };
}

function hideAllBrowserViews() {
  for (const view of browserViews.values()) {
    if (!view.webContents.isDestroyed()) {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }
}

function layoutActiveView() {
  if (!win) return;
  hideAllBrowserViews();
  if (activeRoute === "command") return;
  const view = browserViews.get(activeRoute);
  if (view && !view.webContents.isDestroyed()) {
    view.setBounds(browserBounds());
  }
}

function configureSession(partition) {
  const ses = session.fromPartition(partition);

  if (!ses.__opConfigured) {
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed =
        permission === "clipboard-sanitized-write" ||
        permission === "notifications";

      callback(allowed);
    });

    ses.__opConfigured = true;
  }

  return ses;
}

function createBrowserView(routeKey) {
  const existing = browserViews.get(routeKey);

  if (existing && !existing.webContents.isDestroyed()) {
    return existing;
  }

  const route = LIVE_ROUTES[routeKey];
  if (!route) return null;

  configureSession(route.partition);

  const view = new WebContentsView({
    webPreferences: {
      partition: route.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  browserViews.set(routeKey, view);
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      view.webContents.loadURL(url);
    }

    return { action: "deny" };
  });

  view.webContents.on("did-start-loading", () => {
    sendBrowserState(routeKey, {
      loading: true,
      error: null,
    });
  });

  view.webContents.on("did-stop-loading", () => {
    sendBrowserState(routeKey, {
      loading: false,
      title: view.webContents.getTitle(),
      url: view.webContents.getURL(),
      error: null,
    });
  });

  view.webContents.on("page-title-updated", (_event, title) => {
    sendBrowserState(routeKey, { title });
  });

  view.webContents.on("did-navigate", (_event, url) => {
    sendBrowserState(routeKey, {
      url,
      title: view.webContents.getTitle(),
    });
  });

  view.webContents.on("did-navigate-in-page", (_event, url) => {
    sendBrowserState(routeKey, {
      url,
      title: view.webContents.getTitle(),
    });
  });

  view.webContents.on(
    "did-fail-load",
    (_event, code, description, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        sendBrowserState(routeKey, {
          loading: false,
          url: validatedURL,
          error: `${code}: ${description}`,
        });
      }
    }
  );

  sendBrowserState(routeKey, {
    title: route.label,
    url: route.url,
    loading: true,
    error: null,
  });

  view.webContents.loadURL(route.url);
  return view;
}

function navigateTo(routeKey) {
  activeRoute = routeKey;

  if (routeKey === "command") {
    layoutActiveView();

    if (win && !win.isDestroyed()) {
      win.webContents.send("op:browser-state", {
        route: "command",
        title: "OP Software",
        url: "",
        loading: false,
        error: null,
      });
    }

    return;
  }

  const route = LIVE_ROUTES[routeKey];
  if (!route) return;

  const view = createBrowserView(routeKey);
  if (!view) return;

  layoutActiveView();

  const state = getState(routeKey);

  if (win && !win.isDestroyed()) {
    win.webContents.send("op:browser-state", state);
  }
}

function openTikTokResearch(brandKey) {
  const route = TIKTOK_RESEARCH[brandKey];

  if (!route) {
    return {
      ok: false,
      reason: "Unknown TikTok brand.",
    };
  }

  const existing = researchWindows.get(brandKey);

  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();

    return {
      ok: true,
      reused: true,
      brand: brandKey,
    };
  }

  configureSession(route.partition);

  const research = new BrowserWindow({
    title: `${route.label} TikTok Research`,
    width: 1220,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      partition: route.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  researchWindows.set(brandKey, research);

  research.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      research.loadURL(url);
    }

    return { action: "deny" };
  });

  research.on("closed", () => {
    if (researchWindows.get(brandKey) === research) {
      researchWindows.delete(brandKey);
    }
  });

  research.loadURL(route.url);

  return {
    ok: true,
    reused: false,
    brand: brandKey,
  };
}

async function captureTikTokContext(brandKey) {
  const research = researchWindows.get(brandKey);

  if (!research || research.isDestroyed()) {
    return {
      ok: false,
      version: 4,
      reason: "TikTok research window is not open for this brand.",
    };
  }

  try {
    const result = await research.webContents.executeJavaScript(String.raw`
      (() => {
        const cleanText = (value) =>
          String(value || "")
            .replace(/\u00a0/g, " ")
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        const roundRect = (rect) => ({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          left: Math.round(rect.left),
        });

        const isVisible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        };

        const imageSource = (img) =>
          img?.currentSrc || img?.src || img?.getAttribute?.("src") || "";

        const getImageSource = (element) => {
          if (!element) return null;
          const image = element.matches?.("img") ? element : element.querySelector?.("img");
          const direct = imageSource(image);
          if (direct) return direct;

          const elements = [element, ...Array.from(element.querySelectorAll?.("*") || [])];
          for (const child of elements) {
            const background = window.getComputedStyle(child).backgroundImage;
            if (background && background !== "none" && background.startsWith("url(")) {
              return background
                .replace(/^url\(["']?/, "")
                .replace(/["']?\)$/, "");
            }
          }
          return null;
        };

        const images = Array.from(document.images)
          .filter(isVisible)
          .map((img) => {
            const rect = img.getBoundingClientRect();
            return {
              src: imageSource(img),
              alt: cleanText(img.alt || ""),
              width: img.naturalWidth || 0,
              height: img.naturalHeight || 0,
              renderedWidth: Math.round(rect.width),
              renderedHeight: Math.round(rect.height),
              bounds: roundRect(rect),
            };
          })
          .filter((img) => img.src);

        const links = Array.from(document.querySelectorAll("a[href]"))
          .filter(isVisible)
          .map((a) => ({
            text: cleanText(a.innerText || a.textContent),
            href: a.href || "",
            bounds: roundRect(a.getBoundingClientRect()),
          }))
          .filter((link) => link.href);

        const knownBadges = [
          "Frequent customer",
          "Recent customer",
          "Logistics",
          "Aftersales",
          "Negative",
          "Unreplied",
          "Replied",
        ];

        const ignoredExactText = new Set([
          "Inbox", "Unassigned", "Assigned", "Me", "All", "Urgent", "Overdue",
          "Due soon", "Unreplied", "Unread", "Starred", "Closed", "Quick setup",
          "Automation tools", "Team setup", "Check shop performance", "Need help?",
          "Set up now", "View details",
        ]);

        const looksLikeUsername = (value) => {
          const text = cleanText(value);
          if (!text) return false;
          if (ignoredExactText.has(text)) return false;
          if (knownBadges.includes(text)) return false;
          if (text.length < 2 || text.length > 40) return false;
          if (/\s/.test(text)) return false;
          if (!/^[A-Za-z0-9._-]+$/.test(text)) return false;
          if (/^\d+$/.test(text)) return false;
          return true;
        };

        const leafTextNodes = Array.from(
          document.querySelectorAll("span, div, p, a, strong, b, h1, h2, h3, h4")
        ).filter((element) => {
          if (!isVisible(element)) return false;
          const ownText = cleanText(element.innerText || element.textContent);
          if (!looksLikeUsername(ownText)) return false;
          return !Array.from(element.children || []).some(
            (child) => cleanText(child.innerText || child.textContent) === ownText
          );
        });

        const nearestImages = (rect, limit = 8) =>
          images
            .map((img) => {
              const r = img.bounds;
              const cx = r.x + r.width / 2;
              const cy = r.y + r.height / 2;
              const tx = rect.x + rect.width / 2;
              const ty = rect.y + rect.height / 2;
              return { ...img, distance: Math.round(Math.hypot(cx - tx, cy - ty)) };
            })
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);

        const buildAncestorEvidence = (element) => {
          const evidence = [];
          let node = element;
          for (let depth = 0; depth <= 7 && node; depth += 1) {
            if (!isVisible(node)) break;
            const rect = node.getBoundingClientRect();
            const text = cleanText(node.innerText || node.textContent);
            evidence.push({
              depth,
              tag: node.tagName || "",
              className: typeof node.className === "string" ? node.className.slice(0, 500) : "",
              text: text.slice(0, 1800),
              bounds: roundRect(rect),
              imageSources: Array.from(node.querySelectorAll?.("img") || [])
                .map(imageSource)
                .filter(Boolean)
                .slice(0, 20),
              html: String(node.outerHTML || "").slice(0, 7000),
            });
            node = node.parentElement;
          }
          return evidence;
        };

        const customers = [];
        const seenUsers = new Set();

        for (const usernameElement of leafTextNodes) {
          const username = cleanText(usernameElement.innerText || usernameElement.textContent);
          const key = username.toLowerCase();
          if (seenUsers.has(key)) continue;

          const usernameRect = usernameElement.getBoundingClientRect();
          const evidence = buildAncestorEvidence(usernameElement);
          let bestContainer = evidence[0] || null;

          for (const candidate of evidence) {
            const text = candidate.text || "";
            const h = candidate.bounds?.height || 0;
            const w = candidate.bounds?.width || 0;
            if (text.includes(username) && text.length <= 900 && h >= 28 && h <= 260 && w >= 120) {
              bestContainer = candidate;
            }
          }

          const lines = cleanText(bestContainer?.text || username)
            .split("\n")
            .map(cleanText)
            .filter(Boolean);

          const badges = knownBadges.filter((badge) =>
            lines.some((line) => line.toLowerCase().includes(badge.toLowerCase()))
          );

          const previewLines = lines.filter((line) => {
            if (line === username) return false;
            return !badges.some((badge) => line.toLowerCase() === badge.toLowerCase());
          });

          const nearest = nearestImages(roundRect(usernameRect), 10);
          const avatarCandidate =
            nearest.find((img) => String(img.alt || "").toLowerCase() === "avatar") ||
            nearest.find(
              (img) =>
                img.renderedWidth >= 24 && img.renderedWidth <= 90 &&
                img.renderedHeight >= 24 && img.renderedHeight <= 90
            ) ||
            null;

          customers.push({
            username,
            avatar: avatarCandidate?.src || getImageSource(usernameElement.parentElement) || null,
            avatarCandidate,
            preview: previewLines[0] || "",
            badges,
            text: bestContainer?.text || username,
            bounds: roundRect(usernameRect),
            containerBounds: bestContainer?.bounds || roundRect(usernameRect),
            nearbyImages: nearest,
            evidence,
          });

          seenUsers.add(key);
        }

        customers.sort((a, b) => a.bounds.y - b.bounds.y);

        const bodyText = cleanText(document.body?.innerText || "");
        const bodyLines = bodyText.split("\n").map(cleanText).filter(Boolean);

        const readLabeledValue = (label) => {
          const lower = label.toLowerCase();
          for (let i = 0; i < bodyLines.length; i += 1) {
            const line = bodyLines[i];
            if (line.toLowerCase() !== lower) continue;
            const next = bodyLines[i + 1] || "";
            if (next && next.toLowerCase() !== lower) return next;
          }
          return null;
        };

        const customerStats = {
          waitingTime: readLabeledValue("Waiting time"),
          pastChats: readLabeledValue("Past chats"),
          sentiment: readLabeledValue("Sentiment"),
          averageCsat: readLabeledValue("Average CSAT"),
          totalGmv: readLabeledValue("Total GMV"),
          totalOrders: readLabeledValue("Total orders"),
        };

        const orderIdPattern = /\b\d{16,22}\b/g;
        const orderElements = Array.from(document.querySelectorAll("body *"))
          .filter(isVisible)
          .filter((el) => {
            const own = cleanText(el.innerText || el.textContent);
            if (!own || own.length > 140) return false;
            return orderIdPattern.test(own);
          });

        const orders = [];
        const seenOrders = new Set();

        for (const element of orderElements) {
          const ownText = cleanText(element.innerText || element.textContent);
          const ids = ownText.match(/\b\d{16,22}\b/g) || [];
          for (const orderId of ids) {
            if (seenOrders.has(orderId)) continue;

            let container = element;
            for (let depth = 0; depth < 7 && container?.parentElement; depth += 1) {
              const parent = container.parentElement;
              const rect = parent.getBoundingClientRect();
              const text = cleanText(parent.innerText || parent.textContent);
              if (
                text.includes(orderId) &&
                text.length <= 1800 &&
                rect.width >= 180 &&
                rect.height >= 40 &&
                rect.height <= 700
              ) {
                container = parent;
              } else {
                break;
              }
            }

            const text = cleanText(container.innerText || container.textContent);
            const lines = text.split("\n").map(cleanText).filter(Boolean);
            const rect = roundRect(container.getBoundingClientRect());
            const nearby = nearestImages(rect, 12);
            const localLinks = Array.from(container.querySelectorAll?.("a[href]") || [])
              .map((a) => ({ text: cleanText(a.innerText || a.textContent), href: a.href || "" }))
              .filter((x) => x.href);

            const amount = lines.find((line) => /\$\s?\d+(?:\.\d{1,2})?/.test(line)) || null;
            const status = lines.find((line) =>
              /awaiting|delivered|completed|cancelled|canceled|shipped|collection|processing|refunded|return/i.test(line)
            ) || null;
            const quantity = lines.find((line) => /\bx\d+\b|\b\d+\s+item(?:s)?\b/i.test(line)) || null;
            const productImage = nearby.find((img) =>
              img.renderedWidth >= 40 && img.renderedHeight >= 40 &&
              String(img.alt || "").toLowerCase() !== "avatar"
            ) || null;

            const productName = lines.find((line) => {
              if (line.includes(orderId)) return false;
              if (line === amount || line === status || line === quantity) return false;
              if (/^(order|order id|logistics|return\/refund|details|send updates|send order|add note|cancel order)$/i.test(line)) return false;
              return line.length >= 3 && line.length <= 140;
            }) || null;

            orders.push({
              orderId,
              text,
              lines,
              amount,
              status,
              quantity,
              productName,
              productImage: productImage?.src || null,
              productImageCandidate: productImage,
              bounds: rect,
              links: localLinks,
            });
            seenOrders.add(orderId);
          }
        }

        const avatarImages = images.filter(
          (img) => String(img.alt || "").toLowerCase() === "avatar"
        );

        const likelySelectedCustomer = (() => {
          const withStats = customers.find((customer) => {
            const joined = (customer.evidence || []).map((e) => e.text).join("\n");
            return /Total GMV|Total orders|Past chats|Waiting time/i.test(joined);
          });
          if (withStats) return withStats;

          if (avatarImages.length === 1 && customers.length) {
            const avatar = avatarImages[0];
            return customers
              .map((customer) => ({
                customer,
                distance: Math.hypot(
                  (customer.bounds.x + customer.bounds.width / 2) -
                    (avatar.bounds.x + avatar.bounds.width / 2),
                  (customer.bounds.y + customer.bounds.height / 2) -
                    (avatar.bounds.y + avatar.bounds.height / 2)
                ),
              }))
              .sort((a, b) => a.distance - b.distance)[0]?.customer || null;
          }

          return null;
        })();

        return {
          url: window.location.href,
          title: document.title,
          text: bodyText.slice(0, 25000),
          customers: customers.slice(0, 100),
          selectedCustomer: likelySelectedCustomer,
          customerStats,
          orders: orders.slice(0, 50),
          images: images.slice(0, 400),
          avatarImages: avatarImages.slice(0, 100),
          links: links.slice(0, 300),
          stats: {
            customerCandidates: customers.length,
            imageCount: images.length,
            avatarImageCount: avatarImages.length,
            orderCandidates: orders.length,
            linkCount: links.length,
          },
        };
      })()
    `);

    return {
      ok: true,
      version: 4,
      brand: brandKey,
      capturedAt: new Date().toISOString(),
      ...result,
    };
  } catch (error) {
    return {
      ok: false,
      version: 4,
      reason: String(error?.message || error),
    };
  }
}


async function openTikTokCustomer(brandKey, username) {
  const route = TIKTOK_RESEARCH[brandKey];
  const targetUsername = String(username || "").trim();

  if (!route) {
    return {
      ok: false,
      version: "5.2",
      brand: brandKey,
      username: targetUsername || null,
      reason: "Unknown TikTok brand.",
    };
  }

  if (!targetUsername) {
    return {
      ok: false,
      version: "5.2",
      brand: brandKey,
      username: null,
      reason: "A TikTok username is required.",
    };
  }

  let research = researchWindows.get(brandKey);

  if (!research || research.isDestroyed()) {
    const opened = openTikTokResearch(brandKey);

    if (!opened?.ok) {
      return {
        ok: false,
        version: "5.2",
        brand: brandKey,
        username: targetUsername,
        reason: opened?.reason || "TikTok research window could not be opened.",
      };
    }

    research = researchWindows.get(brandKey);

    if (!research || research.isDestroyed()) {
      return {
        ok: false,
        version: "5.2",
        brand: brandKey,
        username: targetUsername,
        reason: "TikTok research window was opened but is not available.",
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1400));
  }

  try {
    const targetJson = JSON.stringify(targetUsername);

    const script = `(() => {
      const target = ${targetJson};

      const clean = (value) => String(value == null ? "" : value).trim();

      const visible = (element) => {
        if (!element) return false;

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const nodes = Array.from(
        document.querySelectorAll("h1,h2,h3,span,div,p,a,strong,b")
      );

      const matches = nodes.filter((element) => {
        if (!visible(element)) return false;
        return clean(element.innerText || element.textContent) === target;
      });

      if (!matches.length) {
        return {
          ok: false,
          found: false,
          clicked: false,
          username: target,
          reason: "Customer username was not found in the visible TikTok inbox.",
        };
      }

      let best = null;

      for (const element of matches) {
        let row = element;
        let node = element;

        for (let depth = 0; depth < 7; depth += 1) {
          const parent = node.parentElement;
          if (!parent) break;

          const text = clean(parent.innerText || parent.textContent);
          const rect = parent.getBoundingClientRect();

          if (
            text.includes(target) &&
            text.length <= 700 &&
            rect.width >= 120 &&
            rect.height >= 30 &&
            rect.height <= 260
          ) {
            row = parent;
            node = parent;
          } else {
            break;
          }
        }

        const rect = row.getBoundingClientRect();
        const rowText = clean(row.innerText || row.textContent);

        const score =
          (row.querySelector("img") ? 50 : 0) +
          (rowText.includes("Unreplied") ? 10 : 0) +
          (rowText.includes("Frequent customer") ? 10 : 0) +
          (rowText.includes("Recent customer") ? 10 : 0) +
          (rowText.includes("Logistics") ? 5 : 0) +
          Math.max(0, 220 - Math.round(rect.height));

        if (!best || score > best.score) {
          best = { element, row, rowText, score };
        }
      }

      if (!best) {
        return {
          ok: false,
          found: true,
          clicked: false,
          username: target,
          reason: "Customer was found, but no clickable row could be resolved.",
        };
      }

      const row = best.row;

      const clickable =
        row.closest("button,a,[role=button]") ||
        row.querySelector("button,a,[role=button]") ||
        row;

      if (typeof clickable.scrollIntoView === "function") {
        clickable.scrollIntoView({ block: "center", inline: "nearest" });
      }

      const rect = clickable.getBoundingClientRect();

      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + Math.max(1, rect.width / 2),
        clientY: rect.top + Math.max(1, rect.height / 2),
      };

      clickable.dispatchEvent(new MouseEvent("pointerdown", eventInit));
      clickable.dispatchEvent(new MouseEvent("mousedown", eventInit));
      clickable.dispatchEvent(new MouseEvent("mouseup", eventInit));
      clickable.dispatchEvent(new MouseEvent("click", eventInit));

      return {
        ok: true,
        found: true,
        clicked: true,
        username: target,
        rowText: best.rowText,
        tagName: clickable.tagName,
        className: String(clickable.className || ""),
        score: best.score,
        beforeUrl: window.location.href,
      };
    })()`;

    const clickResult = await research.webContents.executeJavaScript(script, true);

    if (!clickResult?.ok) {
      return {
        version: "5.2",
        brand: brandKey,
        username: targetUsername,
        afterUrl: research.webContents.getURL(),
        ...clickResult,
      };
    }

    let context = null;
    let ready = false;
    let attempts = 0;

    for (attempts = 1; attempts <= 12; attempts += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempts === 1 ? 900 : 500));

      context = await captureTikTokContext(brandKey);

      if (!context?.ok) continue;

      const stats = context.customerStats || {};
      const hasStats = Boolean(
        stats.totalGmv ||
        stats.totalOrders ||
        stats.pastChats ||
        stats.waitingTime ||
        stats.sentiment
      );

      const hasOrders = Array.isArray(context.orders) && context.orders.length > 0;

      if (hasStats || hasOrders) {
        ready = true;
        break;
      }
    }

    return {
      ok: true,
      version: "5.2",
      brand: brandKey,
      username: targetUsername,
      found: clickResult.found === true,
      clicked: clickResult.clicked === true,
      ready,
      attempts,
      afterUrl: research.webContents.getURL(),
      customerStats: context?.customerStats || {},
      selectedCustomer: context?.selectedCustomer || null,
      customers: Array.isArray(context?.customers) ? context.customers : [],
      orders: Array.isArray(context?.orders) ? context.orders : [],
      context,
      click: clickResult,
    };
  } catch (error) {
    return {
      ok: false,
      version: "5.2",
      brand: brandKey,
      username: targetUsername,
      reason: String(error?.stack || error?.message || error),
    };
  }
}

function openZendeskTicket(ticketId) {
  const base = "https://opcomicsgames.zendesk.com/agent/tickets";
  const cleanTicket = String(ticketId || "").replace(/[^0-9]/g, "");
  const url = cleanTicket ? `${base}/${cleanTicket}` : base;
  const partition = "persist:op-zendesk";

  configureSession(partition);

  if (zendeskResearchWindow && !zendeskResearchWindow.isDestroyed()) {
    zendeskResearchWindow.show();
    zendeskResearchWindow.focus();
    zendeskResearchWindow.loadURL(url);

    return {
      ok: true,
      reused: true,
      ticketId: cleanTicket || null,
    };
  }

  zendeskResearchWindow = new BrowserWindow({
    title: cleanTicket ? `Zendesk #${cleanTicket}` : "Zendesk",
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  zendeskResearchWindow.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    if (/^https:\/\//i.test(popupUrl)) {
      zendeskResearchWindow.loadURL(popupUrl);
    }

    return { action: "deny" };
  });

  zendeskResearchWindow.on("closed", () => {
    zendeskResearchWindow = null;
  });

  zendeskResearchWindow.loadURL(url);

  return {
    ok: true,
    reused: false,
    ticketId: cleanTicket || null,
  };
}

function createWindow() {
  win = new BrowserWindow({
    title: "OP Software",
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f4f6f8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on("resize", layoutActiveView);
  win.on("maximize", layoutActiveView);
  win.on("unmaximize", layoutActiveView);

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  win.webContents.on("did-finish-load", () => {
    if (activeRoute === "command") {
      navigateTo("command");
    } else {
      sendBrowserState(activeRoute);
    }
  });
}

ipcMain.handle("op:navigate", (_event, routeKey) => {
  navigateTo(routeKey);

  return {
    ok: true,
    route: routeKey,
  };
});

ipcMain.handle("op:browser-action", (_event, action) => {
  const view = browserViews.get(activeRoute);

  if (
    !view ||
    view.webContents.isDestroyed() ||
    activeRoute === "command"
  ) {
    return {
      ok: false,
      reason: "No live workspace is open.",
    };
  }

  const wc = view.webContents;

  if (action === "back" && wc.canGoBack()) {
    wc.goBack();
  }

  if (action === "forward" && wc.canGoForward()) {
    wc.goForward();
  }

  if (action === "reload") {
    wc.reload();
  }

  if (action === "copy-url") {
    clipboard.writeText(wc.getURL());
  }

  if (action === "external") {
    shell.openExternal(wc.getURL());
  }

  return {
    ok: true,
  };
});

ipcMain.handle(
  "op:open-tiktok-research",
  (_event, brandKey) => openTikTokResearch(brandKey)
);

ipcMain.handle(
  "op:capture-tiktok-context",
  async (_event, brandKey) => captureTikTokContext(brandKey)
);

ipcMain.handle(
  "op:open-tiktok-customer",
  async (_event, brandKey, username) => openTikTokCustomer(brandKey, username)
);

ipcMain.handle(
  "op:open-zendesk-ticket",
  (_event, ticketId) => openZendeskTicket(ticketId)
);

ipcMain.handle("op:get-browser-state", () => {
  if (activeRoute === "command") {
    return {
      route: "command",
      title: "OP Software",
      url: "",
      loading: false,
      error: null,
    };
  }

  return getState(activeRoute);
});

app.whenReady().then(() => {
  app.setAppUserModelId("com.outerplanesgames.opsoftware");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
