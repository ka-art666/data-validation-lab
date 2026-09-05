import { chromium } from "playwright";
import fs from "node:fs/promises";

const inputUrl = process.argv[2];

const result = {
  status: "NOT_FOUND",
  source_url: inputUrl ?? null,
  final_url: null,
  restaurant_name: null,
  address: null,
  merchant_name: null,
  email: null,
  phone: null,
  siret: null,
  evidence_excerpt: null,
  challenge_detected: false,
  retrieved_at: new Date().toISOString()
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!inputUrl) {
  fail("Missing target URL.");
}

let target;

try {
  target = new URL(inputUrl);
} catch {
  fail("Invalid URL.");
}

if (
  target.protocol !== "https:" ||
  !["ubereats.com", "www.ubereats.com"].includes(target.hostname)
) {
  fail("Only HTTPS Uber Eats URLs are accepted.");
}

const browser = await chromium.launch({
  headless: true
});

try {
  const context = await browser.newContext({
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: {
      width: 1440,
      height: 1200
    }
  });

  const page = await context.newPage();

  await page.goto(target.href, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  result.final_url = page.url();

  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText().catch(() => "");

  const challengeMarkers = [
    "def.uber.com",
    "recaptcha",
    "encore une étape",
    "contrôle de sécurité",
    "controle de securite",
    "je ne suis pas un robot"
  ];

  const challengeText =
    `${result.final_url}\n${title}\n${body}`.toLowerCase();

  result.challenge_detected = challengeMarkers.some(marker =>
    challengeText.includes(marker)
  );

  if (result.challenge_detected) {
    result.status = "CAPTCHA_REQUIRED";

    await page.screenshot({
      path: "diagnostic.png",
      fullPage: true
    }).catch(() => {});

    await fs.writeFile(
      "result.json",
      JSON.stringify(result, null, 2)
    );

    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  } else {
    const emailMatch = body.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
    );

    const phoneMatch = body.match(
      /(?:\+33|0)[1-9](?:[\s.-]?\d{2}){4}/
    );

    const siretMatch = body.match(
      /\b\d{14}\b/
    );

    const legalMarkers = [
      "ce commerçant certifie",
      "chambre de commerce",
      "cci"
    ];

    const normalizedBody = body.toLowerCase();

    const legalMarkerFound = legalMarkers.some(marker =>
      normalizedBody.includes(marker)
    );

    result.email = emailMatch?.[0] ?? null;
    result.phone = phoneMatch?.[0] ?? null;
    result.siret = siretMatch?.[0] ?? null;

    const evidenceIndex = Math.max(
      normalizedBody.indexOf("ce commerçant certifie"),
      normalizedBody.indexOf("chambre de commerce")
    );

    if (evidenceIndex >= 0) {
      result.evidence_excerpt = body
        .slice(
          Math.max(0, evidenceIndex - 300),
          evidenceIndex + 1500
        )
        .trim();
    }

    if (
      legalMarkerFound &&
      (result.email || result.phone || result.siret)
    ) {
      result.status = "VERIFIED";
    } else if (
      result.email ||
      result.phone ||
      result.siret
    ) {
      result.status = "PARTIAL";
    } else {
      result.status = "NOT_FOUND";
    }

    await fs.writeFile(
      "result.json",
      JSON.stringify(result, null, 2)
    );

    console.log(JSON.stringify(result, null, 2));
  }

  await context.close();
} catch (error) {
  result.status = "BLOCKED";

  await fs.writeFile(
    "result.json",
    JSON.stringify(
      {
        ...result,
        error: String(error?.message ?? error)
      },
      null,
      2
    )
  );

  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
