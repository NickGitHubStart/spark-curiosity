import type { IncomingMessage, ServerResponse } from "node:http";
import { CLOUD_PROXY_URL, CLOUD_REGISTER_SECRET, currentGrokApiKey, currentGrokModel, currentLang } from "../config.js";
import {
  applyOnboardingTemplate, consumeWelcome, listOnboardingTemplates,
  loadMemory, readMemoryFile, registerCloudToken, writeMemoryFile, writeRuntimeConfig,
} from "../memory.js";
import { renderOnboardPage } from "../ui/onboard-ui.js";
import { json, html, parseBody } from "./helpers.js";

export async function handleOnboardingRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/setup") {
    res.writeHead(302, { location: "/onboard" });
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/onboard") {
    html(res, renderOnboardPage(currentLang()));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/onboarding/status") {
    const memory = loadMemory();
    json(res, 200, { onboardingComplete: Boolean(memory.onboardingComplete) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/onboarding/templates") {
    json(res, 200, { templates: listOnboardingTemplates() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/onboarding/select") {
    try {
      const body = await parseBody<{ templateId: string; customNotes?: string }>(req);
      const result = applyOnboardingTemplate(body.templateId, body.customNotes);
      if (!result.ok) { json(res, 404, { error: result.error }); return true; }

      let cloudRegistered = false;
      let cloudError: string | undefined;
      if (CLOUD_PROXY_URL && !currentGrokApiKey()) {
        console.log(`[spark:onboarding] registering cloud token at ${CLOUD_PROXY_URL}`);
        const reg = await registerCloudToken(CLOUD_PROXY_URL, CLOUD_REGISTER_SECRET || undefined);
        if (reg.ok) {
          const writeResult = writeRuntimeConfig({ grokApiKey: reg.token, grokModel: currentGrokModel() });
          if (writeResult.ok) {
            cloudRegistered = true;
            console.log("[spark:onboarding] cloud token registered and saved");
          } else {
            cloudError = `token_obtained_but_write_failed: ${writeResult.error}`;
            console.error("[spark:onboarding]", cloudError);
          }
        } else {
          cloudError = reg.error;
          console.error("[spark:onboarding] cloud token registration failed:", reg.error);
        }
      } else if (!CLOUD_PROXY_URL) {
        console.warn("[spark:onboarding] SPARK_CLOUD_PROXY_URL not set — skipping cloud registration");
      }

      json(res, 200, { ok: true, templateId: result.templateId, cloudRegistered, cloudError });
    } catch (error) {
      json(res, 400, { error: String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/onboarding/skip") {
    const { body, onboardingComplete: _ } = readMemoryFile();
    writeMemoryFile(body, true);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/overlay/init") {
    const welcome = consumeWelcome();
    json(res, 200, { welcome });
    return true;
  }

  return false;
}
