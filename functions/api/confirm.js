// Cloudflare Pages Function — POST /api/confirm
// 토스페이먼츠 결제 승인. 시크릿 키는 코드에 넣지 말고
// Cloudflare 대시보드 > Pages 프로젝트 > Settings > Variables and Secrets 에
// TOSS_SECRET_KEY (결제위젯 연동 키의 시크릿 키: test_gsk_... / live_gsk_...) 로 등록하세요.

const PRICES = {
  ted:  { 1: 12000, 3: 29000 },
  news: { 1: 19000, 3: 45000 },
  pkg:  { 1: 27000, 3: 59000 }
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export async function onRequestPost({ request, env }) {
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
  return json(data, res.status);
}
