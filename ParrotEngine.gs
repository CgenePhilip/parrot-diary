/**
 * 🦜 Parrot Diary Premium Master Engine (v15.0 - Route Fix & Brand Update)
 * [Core]: 프론트엔드 API(doGet) 완벽 보존 + Rabbit 백오피스 엔진 결합
 * [Credit Logic]: 첫 사용자 33점 무상 지급 / 결제 시 기존 잔액 + 33점 추가 / 3점 이하 알림
 * [Bug Fix]: 이메일 잔여 크레딧 점수 누락 버그 해결 (실시간 시트 저장 후 조회 방식)
 * [UI/UX]: 프리미엄 이메일 디자인 수정 및 결제 후 라우팅 수정 ('새 일기 쓰기' 창으로 이동)
 * [Compliance]: 소송 리스크 방어 ('하버드 박사' 문구 제거 -> 'Dr. Parrot AI'로 변경)
 */

const CONFIG = {
  API_KEY: PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY'), 
  MODEL: "gpt-4o-mini",
  SHEET_USERS: "Parrot_Backend_DB",     // 프론트엔드 일기가 접수되는 시트 (필요시 이름 수정)
  SHEET_ARCHIVE: "Archive",  // 메일 발송 후 보관되는 시트
  DEFAULT_CREDITS: 33,       // 🐰 Rabbit과 동일: 무상 33점
  
  CLOUDFLARE_URL: "https://parrot.apnx.org",
  CHECKOUT_URL: "https://tiger-hangeul.lemonsqueezy.com/checkout/buy/15b828f8-5e70-452c-9e11-0b9b41ae8084", // 대표님 스토어 링크
  LS_SIGNING_SECRET: "parrot2026" 
};

// 열 번호 매핑 (doGet에서 저장하는 순서와 동일하게 맞춤)
// A:시간, B:이메일, C:레벨, D:원문, E:AI피드백(JSON), F:선생님코멘트, G:상태, H:잔여크레딧
const COL = { TIME: 1, EMAIL: 2, LEVEL: 3, SENTENCE: 4, FEEDBACK: 5, TEACHER_NOTE: 6, STATUS: 7, CREDITS: 8 };

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🦜 패럿 통합 관리실')
    .addItem('📝 1. 학생 일기 첨삭 창 열기', 'showParrotFeedbackPopup')
    .addItem('💌 2. 프리미엄 강좌 이메일 발송 & Archive 이동', 'approveAndSend') 
    .addSeparator() 
    .addItem('💡 [공장] 1단계: AI 일기 주제 자동 추천', 'generateThemeIdeas') 
    .addItem('🚀 [공장] 2단계: 템플릿 생성 & DB 전송', 'runThemeFactory')
    .addItem('🗑️ [공장] 3단계: 선택한 테마 파이어베이스에서 삭제', 'deleteSelectedTheme') // 👈 이 줄이 꼭 있어야 합니다!
    .addToUi();
}

// =========================================================================
// 🌐 1. 프론트엔드 수신부 (doGet) - 잔액 조회 기능 추가 및 0점 철벽 방어
// =========================================================================
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS); 

  try {
    const userEmail = e.parameter.email || "이메일 없음"; 
    const action = e.parameter.action;

    // 💡 [완벽 픽스 1] 로그인 시 순수 잔액 조회 API (새 일기 쓰기 버튼 누를 때 즉시 확인)
    if (action === "check_balance") {
      let isNewUser = true;
      let currentBalance = CONFIG.DEFAULT_CREDITS;
      
      if (userEmail !== "이메일 없음") {
        const exists = checkIfUserExists(userEmail);
        if (exists) {
          isNewUser = false; // 시트에 기록이 있으면 기존 유저
          currentBalance = getUserCurrentBalance(userEmail); // 정확한 최신 잔액 조회
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({ 
        success: true, 
        remaining: currentBalance,
        isNewUser: isNewUser
      })).setMimeType(ContentService.MimeType.TEXT);
    }

    // --- 기존 일기 제출 및 첨삭 로직 ---
    const userText = e.parameter.text;
    const level = e.parameter.level;
    
    if (!userText) return ContentService.createTextOutput("Parrot Server is Running!");

    // 제출 전 잔액 재확인
    let currentBalance = CONFIG.DEFAULT_CREDITS;
    if (userEmail !== "이메일 없음") {
      currentBalance = checkIfUserExists(userEmail) ? getUserCurrentBalance(userEmail) : CONFIG.DEFAULT_CREDITS;
    }
    
    // 🚨 0점 이하 철벽 차단
    if (currentBalance <= 0) {
      return ContentService.createTextOutput(JSON.stringify({ 
        success: false, 
        corrected_lines: ["🚨 크레딧이 모두 소진되었습니다."], 
        tip: "프리미엄 강좌를 계속 이용하시려면 이메일을 확인하여 크레딧을 충전해주세요!" 
      })).setMimeType(ContentService.MimeType.TEXT);
    }

    // AI 첨삭 생성 및 정확한 1점 차감
    const aiResponseRaw = runFullAutoCorrection(userText);
    let newBalance = Math.max(0, currentBalance - 1);

    // 시트 기록
    sheet.appendRow([new Date(), userEmail, level, userText, aiResponseRaw, "", "🕒 Pending", newBalance]);
    SpreadsheetApp.flush(); 

    // 결과 반환
    const responsePayload = JSON.parse(aiResponseRaw);
    responsePayload.success = true;
    responsePayload.remaining = newBalance;

    return ContentService.createTextOutput(JSON.stringify(responsePayload)).setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    sheet.appendRow([new Date(), "ERROR", err.toString()]);
    return ContentService.createTextOutput(JSON.stringify({ success: false, corrected_lines: ["연결 오류"], tip: err.toString() })).setMimeType(ContentService.MimeType.TEXT);
  }
}

// =========================================================================
// 💰 2. 결제 웹훅 수신부 (doPost) - URL 파라미터 보안 방식 (GAS 전용 완벽 픽스)
// =========================================================================
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);

  try {
    let source = "Unknown";
    let email = "";
    
    // 1. Gumroad 결제 (+33점)
    if (e.parameter && e.parameter.source === "Gumroad") {
      source = "Gumroad";
      email = String(e.parameter.email).toLowerCase().trim();
      
      if (email !== "") {
        const oldBalance = checkIfUserExists(email) ? Math.max(0, getUserCurrentBalance(email)) : 0;
        rechargeCredits(email, oldBalance + 33, source, `Gumroad Purchase (+33) 🚀`, 33);
      }
      return ContentService.createTextOutput("Gumroad Success");
    } 
    
    // 2. LemonSqueezy 결제 (+33점 & URL 파라미터 철벽 보안)
    else if (e.postData && e.postData.contents) {
      
      // 🚨 [수문장 1단계] URL 파라미터 비밀번호 검증 (구글 스크립트에 최적화된 방식)
      const passedSecret = e.parameter.secret;
      if (passedSecret !== CONFIG.LS_SIGNING_SECRET) {
        // 비밀번호가 틀리거나 안 넘어오면 차단하고 시트에 기록!
        sheet.appendRow([new Date(), "SECURITY_ALERT", "System", "URL 비밀번호(Secret) 불일치로 결제 차단됨", `입력된 암호: ${passedSecret || "없음"}`, "", "❌ Blocked", 0]);
        return ContentService.createTextOutput("Security Alert: Invalid Secret");
      }

      const payload = JSON.parse(e.postData.contents);
      if (payload.meta && payload.meta.event_name === "order_created") {
        
        // 🚨 [수문장 2단계] 패럿 상품 검증
        const payloadString = JSON.stringify(payload).toLowerCase();
        if (!payloadString.includes("parrot") && !payloadString.includes("패럿")) {
          sheet.appendRow([new Date(), "PRODUCT_IGNORE", "System", "타이거 한글 등 다른 상품 결제됨", "", "", "⚠️ Ignored", 0]);
          return ContentService.createTextOutput("Ignored: Not a Parrot product");
        }

        // ✅ 수문장 모두 통과! 크레딧 정상 충전
        source = "LemonSqueezy";
        email = String(payload.data.attributes.user_email).toLowerCase().trim();
        
        if (email !== "") {
          const oldBalance = checkIfUserExists(email) ? Math.max(0, getUserCurrentBalance(email)) : 0;
          rechargeCredits(email, oldBalance + 33, source, `LemonSqueezy Purchase (+33) 🚀`, 33);
        }
      }
      return ContentService.createTextOutput("LemonSqueezy Success");
    }
    
    return ContentService.createTextOutput("Ignored");
  } catch (err) {
    sheet.appendRow([new Date(), "WEBHOOK_ERROR", "System", err.message, "", "", "❌ Error", 0]);
    return ContentService.createTextOutput("Error: " + err.message);
  }
}

function rechargeCredits(email, finalAmount, source, msg, addedAmount) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_USERS);
  sheet.appendRow([new Date(), email.toLowerCase().trim(), "System", `[Recharge] ${msg}`, "", "", "✅ Recharge Applied", finalAmount]);
  sendPaymentSuccessEmail(email, finalAmount, addedAmount);
}

function checkIfUserExists(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetEmail = String(email).toLowerCase().trim();
  for (let sheet of ss.getSheets()) {
    const name = sheet.getName();
    if (name === CONFIG.SHEET_USERS || name === CONFIG.SHEET_ARCHIVE) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][COL.EMAIL-1]).toLowerCase().trim() === targetEmail) return true;
      }
    }
  }
  return false;
}

function getUserCurrentBalance(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetEmail = String(email).toLowerCase().trim();
  let latestDate = new Date(0);
  let balance = 0;
  let foundUser = false;

  for (let sheet of ss.getSheets()) {
    const name = sheet.getName();
    if (name === CONFIG.SHEET_USERS || name === CONFIG.SHEET_ARCHIVE) {
      const data = sheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        if (!data[i][COL.EMAIL-1]) continue;
        if (String(data[i][COL.EMAIL-1]).toLowerCase().trim() === targetEmail) {
          const rowCredit = data[i][COL.CREDITS-1];
          const rowDate = new Date(data[i][COL.TIME-1]);
          if (!isNaN(rowCredit) && rowCredit !== "") {
            if (rowDate >= latestDate) {
              balance = Number(rowCredit);
              latestDate = rowDate;
              foundUser = true;
            }
            break; 
          }
        }
      }
    }
  }
  return foundUser ? balance : CONFIG.DEFAULT_CREDITS;
}
// =========================================================================
// 💌 3. 프리미엄 이메일 발송 & 아카이브 (v15 FINAL - 작문 버튼 및 잔액 분기 완벽 적용)
// =========================================================================
function approveAndSend() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const row = sheet.getActiveRange().getRow();
  
  if (row <= 1) return SpreadsheetApp.getUi().alert("⚠️ 일기 내용이 있는 행을 선택해 주세요!");
  if (sheet.getName() === CONFIG.SHEET_ARCHIVE) return SpreadsheetApp.getUi().alert("⚠️ 이미 보관된 일기입니다.");

  const data = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const email = data[COL.EMAIL-1];
  const originalText = data[COL.SENTENCE-1];
  const aiFeedbackRaw = data[COL.FEEDBACK-1];
  const teacherFeedback = data[COL.TEACHER_NOTE-1] || ""; 
  let status = data[COL.STATUS-1];
  
  if (status === "📤 Sending..." || status === "✅ Complete") {
    return SpreadsheetApp.getUi().alert("🦜 이미 발송 처리 중이거나 완료된 항목입니다.");
  }

  // 🚨 [요구사항 3] 0점 철벽 방어: 발송 시 0점 이하면 칼같이 차단하고 충전 유도 메일만 발송!
  let currentBalance = getUserCurrentBalance(email);
  if (currentBalance <= 0) {
    sheet.getRange(row, COL.STATUS).setValue("❌ Need Recharge");
    sendLowCreditEmail(email, currentBalance);
    return SpreadsheetApp.getUi().alert("⚠️ 크레딧이 0점입니다. 발송을 중지하고 충전 안내 메일을 보냈습니다.");
  }
  
  sheet.getRange(row, COL.STATUS).setValue("📤 Sending...");
  sheet.getRange(row, COL.CREDITS).setValue(currentBalance);
  SpreadsheetApp.flush(); 

  let aiData = {};
  try { aiData = JSON.parse(aiFeedbackRaw); } catch(e) {}
  
  // 💡 [요구사항 1] 이메일 파라미터를 물고 레벨 선택 화면(새 일기 쓰기)으로 다이렉트 이동하도록 링크 변경
  const writeLink = CONFIG.CLOUDFLARE_URL + "?email=" + encodeURIComponent(email); 
  const portfolioLink = CONFIG.CLOUDFLARE_URL + "?history_email=" + encodeURIComponent(email); 
  const storeLink = CONFIG.CHECKOUT_URL + (CONFIG.CHECKOUT_URL.includes("?") ? "&" : "?") + "checkout%5Bemail%5D=" + encodeURIComponent(email);
  
  // 💡 [요구사항 2] 3점 이하일 때 프리미엄 가입 강력 권고 블록으로 변환
  const isLowCredit = currentBalance <= 3;
  const creditStatusBlock = isLowCredit 
    ? `<div style="background-color:#fffbeb; padding:25px 20px; border-radius:15px; margin-top:30px; border:2px solid #f59e0b; text-align:center;">
        <span style="font-size:18px; font-weight:900; color:#d97706;">🚨 잔여 크레딧: ${currentBalance}점</span><br>
        <p style="font-size:14px; color:#555; margin: 10px 0 20px 0;">크레딧이 얼마 남지 않았어요! 프리미엄 강좌가 끊기지 않게 프리미엄 멤버십에 가입해 주세요.</p>
        <a href="${storeLink}" style="display:inline-block; background-color:#d97706; color:white; padding:15px 30px; border-radius:30px; text-decoration:none; font-size:16px; font-weight:bold;">⚡ 프리미엄 멤버십 가입/충전하기</a>
       </div>`
    : `<div style="margin-top: 30px; padding: 25px 20px; background-color: #f0fdf4; border-radius: 15px; text-align:center; border: 2px solid #a7f3d0;">
        <p style="margin: 0; font-size: 13px; color: #059669; font-weight:900; letter-spacing: 2px;">🎓 PREMIUM MEMBERSHIP</p>
        <p style="margin: 12px 0 0 0; font-size: 16px; color: #1f2937; font-weight:bold;">잔여 크레딧: <span style="color:#059669; font-size:22px; font-weight:900;">${currentBalance}</span> 점</p>
       </div>`;

  const htmlBody = `
    <div style="font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; background-color: #f0fdf4; padding: 40px 15px; max-width: 600px; margin: 0 auto; border-radius: 20px;">
      
      <div style="text-align: center; margin-bottom: 30px;">
        <div style="font-size: 55px; margin-bottom: 10px;">🦜</div>
        <h2 style="color: #059669; margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.5px;">Dr. Parrot AI's Premium Lecture</h2>
        <p style="color: #4b5563; font-size: 15px; margin-top: 8px;">우리아이를 위한 완벽한 Dr. Parrot AI 영어 첨삭 지도서</p>
      </div>

      <div style="background-color: white; padding: 35px 25px; border-radius: 20px; border: 1px solid #d1fae5; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 25px;">
        <h3 style="color: #374151; margin: 0 0 15px 0; font-size: 18px;">📝 아이가 쓴 문장</h3>
        <div style="font-size: 16px; color: #4b5563; line-height: 1.6; margin-bottom: 20px;">
          ${originalText}
        </div>

        <h3 style="color: #ea580c; margin: 0 0 10px 0; font-size: 18px;">✨ Corrected (완벽한 교정)</h3>
        <ul style="padding-left: 20px; color: #ea580c; font-weight: bold; line-height: 1.6;">
          ${aiData.corrected_lines ? aiData.corrected_lines.map(line => `<li style="margin-bottom: 8px;">${line}</li>`).join('') : "<li>첨삭 내용이 없습니다.</li>"}
        </ul>

        <div style="text-align: center; margin-top: 20px;">
          <a href="${portfolioLink}" style="display: inline-block; background-color: #059669; color: white; padding: 15px 25px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            📚 포트폴리오 Listen & Repeat
          </a>
        </div>
      </div>

      <div style="background-color: #f5f3ff; padding: 25px; border-radius: 20px; border: 1px solid #ede9fe; margin-bottom: 20px;">
        <h3 style="color: #6d28d9; margin: 0 0 10px 0; font-size: 18px;">👩‍🏫 어머니 지도 가이드 (Mom's Guide)</h3>
        <p style="color: #5b21b6; font-size: 15px; line-height: 1.6; margin-bottom: 25px;">
          ${aiData.mom_guide || "훌륭하게 작성했습니다!"}
        </p>

        <h3 style="color: #ea580c; margin: 0 0 10px 0; font-size: 18px;">💡 생생한 원어민 표현 (Vivid Expression)</h3>
        <p style="color: #ea580c; font-weight: bold; font-size: 16px; margin: 0 0 5px 0;">
          "${aiData.vivid_expression ? aiData.vivid_expression.expression : ""}"
        </p>
        <p style="color: #ea580c; font-size: 14px; line-height: 1.5; margin-bottom: 25px;">
          ${aiData.vivid_expression ? aiData.vivid_expression.why : ""}
        </p>

        <h3 style="color: #2563eb; margin: 0 0 10px 0; font-size: 18px;">📖 오늘의 핵심 영단어</h3>
        <ul style="padding-left: 20px; color: #1d4ed8; line-height: 1.6; margin-bottom: 0;">
          ${aiData.expression ? Object.entries(aiData.expression).map(([k, v]) => `<li><strong>${k}</strong> : ${v}</li>`).join('') : ""}
        </ul>
      </div>

      ${teacherFeedback ? `
      <div style="background-color: #ecfdf5; padding: 20px; border-radius: 15px; border-left: 5px solid #10b981; margin-bottom: 20px;">
        <h3 style="color: #047857; margin-top: 0;">👩‍🏫 선생님의 따뜻한 한마디</h3>
        <p style="color: #065f46; font-size: 15px; line-height: 1.6; margin-bottom: 0;">${teacherFeedback.replace(/\n/g, '<br>')}</p>
      </div>
      ` : ''}

      ${creditStatusBlock}

      <div style="text-align: center; margin-top: 35px;">
        <a href="${writeLink}" style="display: inline-block; background-color: #059669; color: white; padding: 18px 40px; text-decoration: none; border-radius: 40px; font-weight: 900; font-size: 18px; box-shadow: 0 4px 15px rgba(5, 150, 105, 0.3);">
          🚀 오늘의 새 일기 작문하러 가기
        </a>
      </div>

    </div>
  `;

  try {
    MailApp.sendEmail({ to: email, subject: "🎓 [Dr. Parrot Diary]의 Premium 강좌가 도착했어요!", htmlBody: htmlBody, name: "Dr. Parrot AI" });
    
    let archiveSheet = ss.getSheetByName(CONFIG.SHEET_ARCHIVE);
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(CONFIG.SHEET_ARCHIVE);
      archiveSheet.appendRow(["접수시간", "이메일", "레벨", "원문", "AI피드백", "선생님코멘트", "상태", "잔여크레딧"]);
      archiveSheet.getRange("A1:H1").setFontWeight("bold").setBackground("#e2e8f0");
    }
    
    data[COL.STATUS-1] = "✅ Complete";
    data[COL.CREDITS-1] = currentBalance; // 차감된 점수로 보관
    archiveSheet.appendRow(data);
    sheet.deleteRow(row);
    
    SpreadsheetApp.getUi().alert("✅ 이메일 발송 완료! 내역이 Archive로 이동되었습니다.");
  } catch (e) { 
    sheet.getRange(row, COL.STATUS).setValue("❌ Error: " + e.message); 
  }
}

function sendPaymentSuccessEmail(email, totalCredit, addedAmount) {
  // 🚨 [라우팅 수정] 결제 성공 메일에서는 '새 일기 쓰기(레벨 선택)' 화면으로 이동하도록 ?email 파라미터 사용
  const writeLink = CONFIG.CLOUDFLARE_URL + "?email=" + encodeURIComponent(email);
  var htmlBody = `
    <div style="font-family: 'Noto Sans KR', sans-serif; background-color: #f0fdf4; padding: 40px 20px; border-radius: 30px; border: 8px solid #a7f3d0; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="text-align: center;">
        <div style="font-size: 60px; margin-bottom: 10px;">🎉</div>
        <h1 style="color: #059669; margin: 0; font-size: 28px; font-weight: 900;">Payment Successful!</h1>
        <p style="font-size: 15px; color: #4b5563; margin-top: 15px; line-height: 1.6;">
          최고의 선택을 하셨습니다 어머니!<br><strong>Dr. Parrot AI 프리미엄</strong> 회원이 되신 걸<br>
          <span style="color: #059669; font-size: 20px; font-weight: 900;">환영합니다! 🎓</span>
        </p>
      </div>
      <div style="background-color: white; padding: 30px; border-radius: 25px; box-shadow: 0 10px 30px rgba(5, 150, 105, 0.1); margin: 30px 0; text-align: center;">
        <p style="font-size: 16px; font-weight: bold; color: #d97706; margin: 0;">💰 Total Balance</p>
        <div style="font-size: 48px; font-weight: 900; color: #059669; margin: 10px 0;">${totalCredit} Credits</div>
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">(${addedAmount} Credits Added Successfully)</p>
      </div>
      <div style="text-align: center; margin-top: 40px;">
        <a href="${writeLink}" style="display: inline-block; background-color: #059669; color: white; padding: 15px 35px; border-radius: 40px; text-decoration: none; font-size: 19px; font-weight: 900; box-shadow: 0 5px 15px rgba(5, 150, 105, 0.4);">
          👉 오늘의 일기 쓰러 가기
        </a>
      </div>
    </div>
  `;
  // 🚨 메일 제목 수정
  MailApp.sendEmail({ to: email, subject: "🦜 Payment Success! Welcome to Premium Class", htmlBody: htmlBody, name: "Dr. Parrot AI" });
}

function sendLowCreditEmail(email, balance) {
  const storeLink = CONFIG.CHECKOUT_URL + (CONFIG.CHECKOUT_URL.includes("?") ? "&" : "?") + "checkout%5Bemail%5D=" + encodeURIComponent(email);
  const htmlBody = `
    <div style="font-family: 'Noto Sans KR', sans-serif; text-align: center; max-width: 500px; margin: 0 auto;">
      <h2 style="color: #d97706;">🦜 Low Credit Alert!</h2>
      <p style="color: #4b5563;">프리미엄 첨삭 강좌를 받기 위한 크레딧이 부족합니다.</p>
      <div style="background-color: #fffbeb; padding: 25px; border-radius: 15px; border: 2px solid #fcd34d;">
        <h3 style="margin:0; color:#b45309; font-size: 24px;">⚠️ Current Balance: ${balance}</h3>
        <p style="color: #78350f; margin-top: 10px;">프리미엄 메일 발송을 위해 33 크레딧 충전이 필요해요!</p>
        <a href="${storeLink}" style="background-color: #d97706; color: white; padding: 15px 30px; text-decoration: none; border-radius: 30px; font-weight: bold; display: inline-block; margin-top: 15px;">⚡ 33 크레딧 충전하기</a>
      </div>
    </div>
  `;
  // 🚨 발송자 이름 수정
  try { MailApp.sendEmail({to: email, subject: "🦜 [Dr. Parrot Diary] 프리미엄 크레딧 충전 안내", htmlBody: htmlBody, name: "Dr. Parrot AI"}); } catch (e) {}
}

// =========================================================================
// 🤖 4. AI 코어 및 팝업, 팩토리 등 (기존 코드 완벽 유지)
// =========================================================================

function runFullAutoCorrection(studentSentence) {
  const systemPrompt = `
    당신은 한국 아이들과 엄마들을 돕는 엘리트 원어민 튜터 'Dr. Parrot AI'입니다.
    학생은 템플릿의 빈칸을 채워 영어 일기("${studentSentence}")를 제출했습니다.

    [🔥 1. 템플릿 역산 및 일치 알고리즘 (CRITICAL)]
    - 학생이 제출한 문장 속 단어들을 보고, 원래 의도된 "모범 정답(Model Answer)"이 무엇인지 먼저 역산하세요.
    - 교정된 문장은 템플릿의 문맥과 100% 일치해야 하며, 학생이 쓴 문장을 하나도 누락하지 마세요.

    [🔥 2. 자연스러운 번역 (NO 기계 번역)]
    - 한국인들이 일상에서 쓰는 자연스러운 구어체를 사용하세요.

    [🔥 3. 어휘(Vocabulary) 누락 절대 금지 & 자연스러운 뜻풀이]
    - 교정된 전체 문장에 쓰인 '핵심 영단어'를 최소 4개 이상 추출하세요.
    - 뜻풀이는 "영어 해설 -> 자연스러운 한국어 뜻" 형태로 작성하세요.

    [🔥 4. 출력 포맷 엄수 (JSON)]
    반환값은 반드시 아래 JSON 형식을 엄격히 지켜야 합니다. (마크다운 블록 금지)

    {
      "corrected_lines": [
        "[1번째 교정된 영어 문장] / [1번째 자연스러운 한글 번역]"
      ],
      "mom_guide": "아이가 쓴 문장에 대한 문법 설명 및 교정 이유 (한국어)",
      "vivid_expression": {
        "expression": "[실생활에서 많이 쓰는 생생한 대체 영어 표현]",
        "why": "이 표현이 왜 더 자연스러운지 설명 (한국어)"
      },
      "expression": {
        "영어단어1": "영영사전 해설 -> 자연스러운 한국어 뜻",
        "영어단어2": "영영사전 해설 -> 자연스러운 한국어 뜻"
      },
      "tip": "🌟 당신의 노력과 열정이 빛나고 있어요! 계속 이렇게 멋진 모습 보여주세요! 💖"
    }
  `;

  try {
    const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
      method: "post", contentType: "application/json",
      headers: { Authorization: "Bearer " + CONFIG.API_KEY },
      payload: JSON.stringify({
        model: CONFIG.MODEL, 
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `학생 문장: "${studentSentence}"` }], 
        temperature: 0.3 
      }),
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText()).choices[0].message.content;
  } catch (e) {
    return JSON.stringify({ corrected_lines: ["🚨 통신 에러"], tip: e.toString() });
  }
}

function showParrotFeedbackPopup() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const row = sheet.getActiveRange().getRow();
  if (row <= 1) return SpreadsheetApp.getUi().alert("⚠️ 일기 내용이 있는 행을 선택해주세요!");

  const originalSentence = sheet.getRange(row, 4).getValue(); 
  const aiFeedback = sheet.getRange(row, 5).getValue();

  const html = HtmlService.createTemplateFromFile('Popup');
  html.row = row; html.sentence = originalSentence; html.feedback = aiFeedback;
  SpreadsheetApp.getUi().showModalDialog(html.evaluate().setWidth(950).setHeight(800), '🦜 Parrot Teacher Desk');
}

function updateFeedback(row, newText) {
  SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getRange(row, 6).setValue(newText);
  return "✅ 저장 완료!";
}

function runTeacherAssistant(currentFeedback) { 
  const systemPrompt = `
    당신은 엘리트 보조교사 'Parrot Assistant'입니다. 
    선생님이 적은 [메모]를 분석하여, 학생에게 감동을 주는 [이중언어 피드백]으로 변환해주세요.
    🚨 "물론이죠!", "네, 알겠습니다" 같은 수다를 절대 포함하지 마세요!! 
  `;
  try {
    const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
      method: "post", contentType: "application/json", headers: { Authorization: "Bearer " + CONFIG.API_KEY },
      payload: JSON.stringify({ model: CONFIG.MODEL, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: currentFeedback }], temperature: 0.7 }),
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText()).choices[0].message.content;
  } catch (e) { return currentFeedback + " (⚠️ 에러 발생)"; }
}

const FIREBASE_PROJECT_ID = "parrot-diary"; 
function runThemeFactory() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Theme_Factory");
  if (!sheet) { SpreadsheetApp.getUi().alert("🚨 'Theme_Factory' 라는 이름의 탭을 먼저 만들어주세요!"); return; }

  const data = sheet.getDataRange().getValues();
  let generatedCount = 0;

  for (let i = 1; i < data.length; i++) {
    const themeKr = data[i][0]; 
    const status = data[i][1];  

    if (themeKr && !status) {
      sheet.getRange(i + 1, 2).setValue("⏳ 생성 중...");
      SpreadsheetApp.flush(); 

      try {
        const jsonResult = callOpenAIToGenerateTheme(themeKr);
        const docId = "theme_" + new Date().getTime();
        uploadToFirestore(docId, jsonResult);
        sheet.getRange(i + 1, 2).setValue("✅ 완료");
        sheet.getRange(i + 1, 3).setValue(docId); 
        generatedCount++;
      } catch (error) { sheet.getRange(i + 1, 2).setValue("❌ 에러: " + error.message); }
    }
  }
  SpreadsheetApp.getUi().alert(`🎉 공장 가동 완료! 총 ${generatedCount}개의 테마가 파이어베이스로 전송되었습니다.`);
}

function callOpenAIToGenerateTheme(themeKr) {
  const url = "https://api.openai.com/v1/chat/completions";
  const systemPrompt = `
  You are an expert English teacher creating materials for a diary app.
  Respond ONLY with a valid JSON object. Do not include markdown tags like \`\`\`json.
  
  [CRITICAL RULES]
  1. No vocabulary repetition: Use distinct, various words for every single sentence.
  2. Base forms only: Keywords MUST be base forms.
  3. Blank Format (STRICT) - 🚨 LEVEL SPECIFIC RULES:
     - 🌱 Beginner: 1 blank per sentence. Format: [blank_1_KOREAN_MEANING]
     - 🏃 Intermediate: Exactly 2 blanks per sentence. The FIRST blank MUST be [blank_1_KOREAN_MEANING] and the SECOND blank MUST be [blank_2_word]. DO NOT put hint words (like 'nature') inside the second blank.
     - 🔥 Advanced: 3 blanks per sentence. Format: [blank_number_word] ONLY.
     - Numbering MUST reset to 1 for every new sentence.
  
  4. 🚨 PERFECT ARTICLES (a/an) - FATAL GRAMMAR RULE 🚨:
     - If the intended answer keyword starts with a vowel (a, e, i, o, u), you MUST write 'an' before the blank. (Example: "I want to eat an [blank_1_사과]" -> intended word: apple)
     - If it starts with a consonant, use 'a'. (Example: "I saw a [blank_1_벌레]" -> intended word: bug)
     - NEVER output 'a [blank]' if the intended answer is a vowel-starting word like 'insect' or 'animal'.
  
  5. Keyword Match (STRICT): The 'keywords' array MUST absolutely contain ALL correct base-form answers required to fill every blank. Never omit the intended answer words. Add 2-3 extra decoy words related to the theme.

  [MANDATORY OUTPUT STRUCTURE EXAMPLE]
  {
    "theme_en": "Going to the Supermarket",
    "theme_kr": "마트에 가기",
    "levels": {
      "beginner": { "template": [ "I want to eat an [blank_1_사과]." ], "keywords": ["apple", "banana", "eat", "buy"] },
      "intermediate": { "template": [ "Yesterday, I [blank_1_가다] to the [blank_2_word]." ], "keywords": ["go", "supermarket", "market"] },
      "advanced": { "template": [ "As soon as we [blank_1_word] at the store, I [blank_2_word] straight to the [blank_3_word] aisle." ], "keywords": ["arrive", "head", "snack", "run", "store"] }
    }
  }
  `;

  const payload = {
    model: CONFIG.MODEL, 
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Create a diary template for the theme: "${themeKr}". Return ONLY JSON.` }],
    temperature: 0.7 // 💡 대표님의 의견대로 창의성 0.7을 유지합니다!
  };

  const response = UrlFetchApp.fetch(url, { method: "post", headers: { "Authorization": "Bearer " + CONFIG.API_KEY, "Content-Type": "application/json" }, payload: JSON.stringify(payload) });
  let content = JSON.parse(response.getContentText()).choices[0].message.content;
  return JSON.parse(content.replace(/```json/gi, '').replace(/```/gi, '').trim());
}

function uploadToFirestore(docId, jsonObject) {
  const firestoreData = { fields: convertToFirestoreFormat(jsonObject).mapValue.fields };
  const firebaseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/parrot_templates?documentId=${docId}`;
  const res = UrlFetchApp.fetch(firebaseUrl, { method: "post", contentType: "application/json", payload: JSON.stringify(firestoreData), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("파이어베이스 전송 실패: " + res.getContentText());
}

function convertToFirestoreFormat(data) {
  if (typeof data === 'string') return { stringValue: data };
  if (typeof data === 'number') return { doubleValue: data };
  if (typeof data === 'boolean') return { booleanValue: data };
  if (Array.isArray(data)) return { arrayValue: { values: data.map(convertToFirestoreFormat) } };
  if (typeof data === 'object' && data !== null) {
    let fields = {};
    for (let key in data) fields[key] = convertToFirestoreFormat(data[key]);
    return { mapValue: { fields: fields } };
  }
  return { nullValue: null };
}

function generateThemeIdeas() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Theme_Factory");
  if (!sheet) return SpreadsheetApp.getUi().alert("🚨 'Theme_Factory' 탭이 없습니다!");

  sheet.getRange("A1").setValue("⏳ AI가 아이들 취향을 분석해 주제를 뽑는 중...");
  SpreadsheetApp.flush();

  const existingData = sheet.getRange("A2:A" + Math.max(sheet.getLastRow(), 2)).getValues();
  const existingThemes = existingData.map(row => row[0]).filter(String).join(", ");

  const systemPrompt = `
    당신은 초등~중학생용 영어 일기 앱의 수석 콘텐츠 기획자입니다.
    아이들의 평범한 일상 속에 숨겨진 재미, 흥미, 모험을 자극하는 '영어 일기 주제(한국어)' 10개를 기획하세요.
    [기존 주제 목록]: ${existingThemes}
    반드시 ["주제1", "주제2", "주제3"...] 형태의 JSON Array(배열)로만 대답하세요.
  `;

  try {
    const res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
      method: "post", headers: { "Authorization": "Bearer " + CONFIG.API_KEY, "Content-Type": "application/json" },
      payload: JSON.stringify({ model: CONFIG.MODEL, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "아이들이 열광할 새로운 일기 테마 10개를 JSON 배열로 추천해줘." }], temperature: 0.9 })
    });
    const newThemes = JSON.parse(JSON.parse(res.getContentText()).choices[0].message.content.replace(/```json/gi, '').replace(/```/gi, '').trim());
    
    let startRow = sheet.getLastRow() + 1;
    if (startRow === 2 && !sheet.getRange("A2").getValue()) startRow = 2; 
    sheet.getRange(startRow, 1, newThemes.length, 3).setValues(newThemes.map(theme => [theme, "", ""]));
    sheet.getRange("A1").setValue("한글 주제"); 
    SpreadsheetApp.getUi().alert(`🎉 기획 완료! ${newThemes.length}개의 주제를 가져왔습니다!`);
  } catch (error) {
    sheet.getRange("A1").setValue("한글 주제");
    SpreadsheetApp.getUi().alert("❌ 기획 실패: " + error.message);
  }
}
// =========================================================================
// 🗑️ [공장] 3단계: 파이어베이스 DB에서 불량 테마 영구 삭제 (독립형/철벽버전)
// =========================================================================
function deleteSelectedTheme() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Theme_Factory");
    if (!sheet) return;
    
    const row = sheet.getActiveRange().getRow();
    if (row <= 1) return SpreadsheetApp.getUi().alert("⚠️ 삭제할 테마가 있는 행(숫자)을 선택해 주세요.");
    
    const docId = sheet.getRange(row, 3).getValue(); // C열에 있는 ID 가져오기
    if (!docId) return SpreadsheetApp.getUi().alert("⚠️ 아직 파이어베이스에 전송되지 않은 테마입니다.");
    
    const ui = SpreadsheetApp.getUi();
    const response = ui.alert('파이어베이스에서 삭제', '정말 이 테마를 학생들 앱에서 영구 삭제하시겠습니까?', ui.ButtonSet.YES_NO);
    
    if (response == ui.Button.YES) {
      // 💡 변수 충돌 에러를 막기 위해 프로젝트 ID(parrot-diary)를 직접 하드코딩!
      const firebaseUrl = `https://firestore.googleapis.com/v1/projects/parrot-diary/databases/(default)/documents/parrot_templates/${docId}`;
      
      const res = UrlFetchApp.fetch(firebaseUrl, { method: "DELETE", muteHttpExceptions: true });
      
      if (res.getResponseCode() === 200 || res.getResponseCode() === 204) {
        sheet.getRange(row, 2).setValue("🗑️ 앱에서 삭제됨"); // B열 상태 업데이트
        ui.alert("✅ 앱에서 완벽하게 삭제되었습니다!");
      } else {
        ui.alert("❌ 파이어베이스 삭제 실패: " + res.getContentText());
      }
    }
  } catch (error) {
    // 시커먼 에러창 대신 원인을 정확히 알려주는 팝업
    SpreadsheetApp.getUi().alert("❌ 스크립트 에러 발생: " + error.message);
  }
}