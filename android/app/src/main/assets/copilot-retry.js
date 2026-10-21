const CLIENT_ID = "Ov23li8tweQw6odWQebz";
const DEFAULT_RETRY_DELAYS_MS = [1500, 4000];
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000;
const SYNTHETIC_ATTACHMENT_PROMPT = "Attached media from tool result:";

function normalizeDomain(url) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function getUrls(domain) {
  return {
    DEVICE_CODE_URL: `https://${domain}/login/device/code`,
    ACCESS_TOKEN_URL: `https://${domain}/login/oauth/access_token`,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isImageMessage(message) {
  if (message?.role !== "user") return false;

  const content = message.content;
  if (typeof content === "string") {
    return content === SYNTHETIC_ATTACHMENT_PROMPT;
  }
  if (!Array.isArray(content)) return false;

  return content.some(
    (part) =>
      (part?.type === "text" || part?.type === "input_text") &&
      part.text === SYNTHETIC_ATTACHMENT_PROMPT,
  );
}

function requestDetails(url, body) {
  try {
    if (body?.messages && url.includes("completions")) {
      const last = body.messages[body.messages.length - 1];
      return {
        isVision: body.messages.some(
          (message) =>
            Array.isArray(message.content) &&
            message.content.some((part) => part.type === "image_url"),
        ),
        isAgent: last?.role !== "user" || isImageMessage(last),
      };
    }

    if (body?.input) {
      const last = body.input[body.input.length - 1];
      return {
        isVision: body.input.some(
          (item) =>
            Array.isArray(item?.content) &&
            item.content.some((part) => part.type === "input_image"),
        ),
        isAgent: last?.role !== "user" || isImageMessage(last),
      };
    }

    if (body?.messages) {
      const last = body.messages[body.messages.length - 1];
      const hasNonToolCalls =
        Array.isArray(last?.content) &&
        last.content.some((part) => part?.type !== "tool_result");

      return {
        isVision: body.messages.some(
          (message) =>
            Array.isArray(message?.content) &&
            message.content.some(
              (part) =>
                part?.type === "image" ||
                (part?.type === "tool_result" &&
                  Array.isArray(part?.content) &&
                  part.content.some((nested) => nested?.type === "image")),
            ),
        ),
        isAgent: !(last?.role === "user" && hasNonToolCalls) || isImageMessage(last),
      };
    }
  } catch {
    return { isVision: false, isAgent: false };
  }

  return { isVision: false, isAgent: false };
}

async function isExpired(response) {
  if (response.status === 401) return true;
  if (response.status !== 403) return false;

  try {
    const text = await response.clone().text();
    return /token expired/i.test(text);
  } catch {
    return false;
  }
}

async function fetchWithRetry(input, init, replayable, retryDelays) {
  let response = await fetch(input, init);

  for (const delay of retryDelays) {
    if (!(await isExpired(response))) break;
    if (!replayable) break;

    await sleep(delay);
    response = await fetch(replayable.clone(), init);
  }

  return response;
}

export async function CopilotRetryPlugin(_input, options = {}) {
  const retryDelays = Array.isArray(options.retryDelays)
    ? options.retryDelays
    : DEFAULT_RETRY_DELAYS_MS;

  return {
    auth: {
      provider: "github-copilot",
      methods: [
        {
          type: "oauth",
          label: "Login with GitHub Copilot",
          prompts: [
            {
              type: "select",
              key: "deploymentType",
              message: "Select GitHub deployment type",
              options: [
                {
                  label: "GitHub.com",
                  value: "github.com",
                  hint: "Public",
                },
                {
                  label: "GitHub Enterprise",
                  value: "enterprise",
                  hint: "Data residency or self-hosted",
                },
              ],
            },
            {
              type: "text",
              key: "enterpriseUrl",
              message: "Enter your GitHub Enterprise URL or domain",
              placeholder: "company.ghe.com or https://company.ghe.com",
              when: {
                key: "deploymentType",
                op: "eq",
                value: "enterprise",
              },
              validate: (value) => {
                if (!value) return "URL or domain is required";
                try {
                  const url = value.includes("://")
                    ? new URL(value)
                    : new URL(`https://${value}`);
                  if (!url.hostname) return "Please enter a valid URL or domain";
                  return undefined;
                } catch {
                  return "Please enter a valid URL (e.g., company.ghe.com or https://company.ghe.com)";
                }
              },
            },
          ],
          async authorize(inputs = {}) {
            const deploymentType = inputs.deploymentType || "github.com";
            let domain = "github.com";

            if (deploymentType === "enterprise") {
              domain = normalizeDomain(inputs.enterpriseUrl);
            }

            const urls = getUrls(domain);
            const deviceResponse = await fetch(urls.DEVICE_CODE_URL, {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "User-Agent": "opencode/mobile",
              },
              body: JSON.stringify({
                client_id: CLIENT_ID,
                scope: "read:user",
              }),
            });

            if (!deviceResponse.ok) {
              throw new Error("Failed to initiate device authorization");
            }

            const deviceData = await deviceResponse.json();

            return {
              url: deviceData.verification_uri,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto",
              async callback() {
                while (true) {
                  const response = await fetch(urls.ACCESS_TOKEN_URL, {
                    method: "POST",
                    headers: {
                      Accept: "application/json",
                      "Content-Type": "application/json",
                      "User-Agent": "opencode/mobile",
                    },
                    body: JSON.stringify({
                      client_id: CLIENT_ID,
                      device_code: deviceData.device_code,
                      grant_type:
                        "urn:ietf:params:oauth:grant-type:device_code",
                    }),
                  });

                  if (!response.ok) return { type: "failed" };

                  const data = await response.json();

                  if (data.access_token) {
                    const result = {
                      type: "success",
                      refresh: data.access_token,
                      access: data.access_token,
                      expires: 0,
                    };

                    if (deploymentType === "enterprise") {
                      result.enterpriseUrl = domain;
                    }

                    return result;
                  }

                  if (data.error === "authorization_pending") {
                    await sleep(
                      deviceData.interval * 1000 +
                        OAUTH_POLLING_SAFETY_MARGIN_MS,
                    );
                    continue;
                  }

                  if (data.error === "slow_down") {
                    let interval = deviceData.interval + 5;
                    if (
                      typeof data.interval === "number" &&
                      data.interval > 0
                    ) {
                      interval = data.interval;
                    }
                    await sleep(
                      interval * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS,
                    );
                    continue;
                  }

                  if (data.error) return { type: "failed" };

                  await sleep(
                    deviceData.interval * 1000 +
                      OAUTH_POLLING_SAFETY_MARGIN_MS,
                  );
                }
              },
            };
          },
        },
      ],
      async loader(getAuth) {
        const info = await getAuth();
        if (!info || info.type !== "oauth") return {};

        return {
          apiKey: "",
          async fetch(request, init) {
            const current = await getAuth();
            if (current.type !== "oauth") return fetch(request, init);

            const url =
              request instanceof URL
                ? request.href
                : typeof request === "string"
                  ? request
                  : request.url;
            let body = init?.body;
            if (typeof body === "string") {
              try {
                body = JSON.parse(body);
              } catch {
                body = undefined;
              }
            }
            const { isVision, isAgent } = requestDetails(url, body);
            const headers = new Headers(init?.headers);

            headers.delete("x-api-key");
            headers.delete("authorization");
            headers.set("x-initiator", isAgent ? "agent" : "user");
            headers.set("User-Agent", "opencode/mobile");
            headers.set("Authorization", `Bearer ${current.refresh}`);
            headers.set("Openai-Intent", "conversation-edits");

            if (isVision) {
              headers.set("Copilot-Vision-Request", "true");
            }

            let replayable = null;
            if (init?.body == null || typeof init.body === "string") {
              try {
                replayable =
                  request instanceof Request
                    ? request.clone()
                    : new Request(request, init);
              } catch {
                replayable = null;
              }
            }

            return fetchWithRetry(
              request,
              { ...init, headers },
              replayable,
              retryDelays,
            );
          },
        };
      },
    },
  };
}
