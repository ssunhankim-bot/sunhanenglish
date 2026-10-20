// Cloudflare Pages Function — POST /api/confirm
// 1) 토스페이먼츠 결제 승인  2) 승인 성공 시 구글 시트 기록 + 알림 메일 (Apps Script 웹앱)
//
// Cloudflare > Pages 프로젝트 > Settings > Variables and Secrets (Production)
//   TOSS_SECRET_KEY       토스 시크릿 키 (test_gsk_... / live_gsk_...)
//   SHEET_WEBHOOK_URL     Apps Script 웹앱 URL (https://script.google.com/macros/s/.../exec)
//   SHEET_WEBHOOK_SECRET  Apps Script 코드의 SECRET 과 같은 값
// 시트 관련 두 값이 없으면 기록·알림만 건너뛰고 결제 승인은 그대로 진행합니다.

const PRICES = {
  ted:  { 1: 12000, 3: 29000 },
  news: { 1: 19000, 3: 45000 },
  pkg:  { 1: 27000, 3: 59000 }
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const clean = (v, max) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, max);

async function notifySheet(env, payload) {
  if (!env.SHEET_WEBHOOK_URL || !env.SHEET_WEBHOOK_SECRET) return;
  try {
    await fetch(env.SHEET_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.SHEET_WEBHOOK_SECRET, ...payload })
    });
  } catch (e) {
    console.log("sheet notify failed", e && e.message);
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try { body = await request.json(); } catch { return json({ message: "잘못된 요청입니다." }, 400); }
  const { paymentKey, orderId } = body;
  const amount = Number(body.amount);

  // orderId 형식: SH-{product}-{months}-{random}  → 금액 위변조 검증
  const m = /^SH-(ted|news|pkg)-(1|3)-[A-Za-z0-9]+$/.exec(orderId || "");
  if (!paymentKey || !m) return json({ message: "주문 정보가 올바르지 않습니다." }, 400);
  if (PRICES[m[1]][m[2]] !== amount) return json({ message: "결제 금액이 상품 금액과 다릅니다." }, 400);
  if (!env.TOSS_SECRET_KEY) return json({ message: "서버 설정(TOSS_SECRET_KEY)이 없습니다." }, 500);

  const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(env.TOSS_SECRET_KEY + ":"),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ paymentKey, orderId, amount })
  });
  const data = await res.json();

  if (res.ok) {
    const buyer = body.buyer || {};
    const task = notifySheet(env, {
      orderId,
      product: m[1],
      months: Number(m[2]),
      amount: data.totalAmount ?? amount,
      approvedAt: data.approvedAt || new Date().toISOString(),
      method: clean(data.method, 30),
      name: clean(buyer.name, 40),
      phone: clean(buyer.phone, 20).replace(/\D/g, ""),
      email: clean(buyer.email, 100),
      test: env.TOSS_SECRET_KEY.startsWith("test_")
    });
    // 고객 화면은 기다리지 않게, 응답 후 백그라운드로 기록
    if (typeof waitUntil === "function") waitUntil(task); else await task;
  }

  return json(data, res.status);
}
