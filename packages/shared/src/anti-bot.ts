export interface DetectAntiBotOptions {
  url?: string;
}

const GENERIC_ANTI_BOT_PATTERNS = [
  /api-services-support@amazon\.com/i,
  /validatecaptcha/i,
  /captchacharacters/i,
  /automated access to amazon/i,
  /enter the characters you see/i,
  /type the characters you see/i,
  /sorry, we just need to make sure you're not a robot/i,
  /not a robot/i,
  /are you a robot/i,
  /access denied/i,
  /cloudflare/i,
  /verify you are human/i,
  /unusual traffic/i,
  /cf-browser-verification/i,
  /challenge-platform/i,
  /attention required! \| cloudflare/i,
];

const AMAZON_PRODUCT_MARKERS = [
  /id=["']productTitle["']/i,
  /id=["']corePriceDisplay_desktop_feature_div["']/i,
  /id=["']priceblock_ourprice["']/i,
  /data-asin=["'][A-Z0-9]{10}["']/i,
];

function isAmazonUrl(url: string | undefined): boolean {
  return url?.includes('amazon.') ?? false;
}

function looksLikeAmazonProductPage(html: string): boolean {
  return AMAZON_PRODUCT_MARKERS.some((pattern) => pattern.test(html));
}

export function detectAntiBot(
  html: string,
  statusCode?: number,
  options: DetectAntiBotOptions = {},
): boolean {
  if (statusCode === 403 || statusCode === 429) return true;

  if (isAmazonUrl(options.url) && looksLikeAmazonProductPage(html)) {
    return false;
  }

  return GENERIC_ANTI_BOT_PATTERNS.some((pattern) => pattern.test(html));
}
