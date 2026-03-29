import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, getDocs, addDoc, query, where } from 'firebase/firestore';

const ParrotFrontApp = () => {
  const [step, setStep] = useState('intro'); 
  const [email, setEmail] = useState('');
  const [showConfetti, setShowConfetti] = useState(false);

  const [currentLevel, setCurrentLevel] = useState('beginner');
  const [templateData, setTemplateData] = useState(null);
  const [diaryInput, setDiaryInput] = useState('');
  
  const [credits, setCredits] = useState(() => {
    const saved = localStorage.getItem('parrot_credits');
    return saved !== null ? parseInt(saved, 10) : 33;
  });

  const [isLoading, setIsLoading] = useState(true);
  const [aiResult, setAiResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingId, setPlayingId] = useState(null); 
  const [needExternalBrowser, setNeedExternalBrowser] = useState(false);
  const [historyList, setHistoryList] = useState([]);

  useEffect(() => {
    localStorage.setItem('parrot_credits', credits);
  }, [credits]);

  const levelConfig = {
    'beginner': { label: '초보', activeClass: 'bg-lime-500 text-white shadow-md shadow-lime-200 scale-105' },
    'intermediate': { label: '중간', activeClass: 'bg-green-600 text-white shadow-md shadow-green-200 scale-105' },
    'advanced': { label: '고급', activeClass: 'bg-emerald-600 text-white shadow-md shadow-emerald-200 scale-105' }
  };

  const pickOneSentence = (templateArray) => {
    if (!templateArray || templateArray.length === 0) return '';
    const randomIndex = Math.floor(Math.random() * templateArray.length);
    return templateArray[randomIndex];
  };

  const formatBlankForDisplay = (text) => {
    if (!text) return '';
    return text.replace(/\[blank_(\d+)_([^\]]+)\]/g, '[_ _ _ _ _$1_$2]');
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const historyEmail = urlParams.get('history_email');
    const autoEmail = urlParams.get('email'); // 💡 [수정] 결제 완료 메일에서 넘어올 때 사용할 파라미터

    if (historyEmail) {
      setEmail(historyEmail);
      fetchHistory(historyEmail); 
    } else if (autoEmail) {
      // 결제 성공 메일에서 넘어오면, 이메일만 채워두고 인트로(레벨선택) 화면에 머물게 합니다!
      setEmail(autoEmail); 
    }

    const fetchRandomTemplate = async () => {
      setIsLoading(true);
      try {
        const querySnapshot = await getDocs(collection(db, "parrot_templates"));
        const templates = [];
        querySnapshot.forEach((doc) => { templates.push(doc.data()); });

        if (templates.length > 0) {
          const randomIndex = Math.floor(Math.random() * templates.length);
          const randomData = templates[randomIndex];
          setTemplateData(randomData); 
          if (randomData.levels && randomData.levels.beginner) {
            setDiaryInput(formatBlankForDisplay(pickOneSentence(randomData.levels.beginner.template)));
          }
        }
      } catch (error) {
        console.error("데이터 로딩 실패:", error);
      }
      setIsLoading(false);
    };
    
    fetchRandomTemplate();
  }, []);

  const fetchHistory = async (targetEmail) => {
    setIsLoading(true);
    try {
      const q = query(collection(db, "parrot_history"), where("email", "==", targetEmail));
      const querySnapshot = await getDocs(q);
      const docs = [];
      querySnapshot.forEach(doc => docs.push({ id: doc.id, ...doc.data() }));
      
      docs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      
      setHistoryList(docs);
      setStep('history'); 
    } catch (error) {
      console.error("히스토리 로딩 실패:", error);
      alert("일기 기록을 불러오지 못했습니다.");
    }
    setIsLoading(false);
  };

  const handleLevelChange = (level) => {
    setCurrentLevel(level);
    if (templateData && templateData.levels[level]) {
      setDiaryInput(formatBlankForDisplay(pickOneSentence(templateData.levels[level].template)));
    }
  };

  const handleStart = () => {
    if (!email.includes('@')) {
      alert("결과를 받아보실 올바른 이메일 주소를 입력해 주세요! 🦜");
      return;
    }
    setShowConfetti(true);
    setTimeout(() => { setShowConfetti(false); setStep('writing'); }, 2000); 
  };

  const handleRewrite = async () => {
    if (credits <= 0) {
      alert("잔여 크레딧이 없습니다. 충전이 필요합니다! 🦜");
      return;
    }

    setIsProcessing(true);
    const GAS_URL = "https://script.google.com/macros/s/AKfycbwbtPm73hkDilxPQFqn_bxvBEeZDthaXLabfz2E7raBM2Uxa3hIif9cPyBNIUCVvpbw/exec";

    try {
      const queryParams = new URLSearchParams({ text: diaryInput, level: currentLevel, email: email }).toString();
      const response = await fetch(`${GAS_URL}?${queryParams}`, { method: "GET", mode: "cors" });
      const data = JSON.parse(await response.text());
      
      setAiResult(data);
      setCredits(prev => prev - 1);

      try {
        await addDoc(collection(db, "parrot_history"), {
          email: email,
          level: currentLevel,
          original_text: diaryInput,
          ai_result: data,
          created_date: new Date().toISOString()
        });
      } catch (e) {
        console.error("파이어베이스 DB 저장 에러:", e);
      }

    } catch (error) {
      console.error("통신 실패:", error);
      alert("연결에 실패했습니다. (콘솔 로그를 확인해 주세요)");
    } finally {
      setIsProcessing(false);
    }
  };

  const stopAudioSafe = () => {
    try {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } catch (e) { console.error("오디오 정지 에러:", e); }
    setIsPlaying(false);
    setPlayingId(null);
  };

  useEffect(() => { return () => stopAudioSafe(); }, []);

  const closePopup = () => {
    stopAudioSafe();
    setAiResult(null);
  };

  const handleListenAndRepeat = (targetAiResult, itemId = 'popup') => {
    if (!('speechSynthesis' in window)) {
      setNeedExternalBrowser(true);
      return;
    }

    if (isPlaying && playingId === itemId) {
      stopAudioSafe();
      return;
    }

    if (!targetAiResult || !targetAiResult.corrected_lines) return;

    try {
      window.speechSynthesis.cancel(); 
      setIsPlaying(true);
      setPlayingId(itemId);

      const parsedLines = targetAiResult.corrected_lines.map(line => {
        const parts = line.split(' / ');
        return { en: parts[0], kr: parts[1] || "" };
      });

      let queue = [];
      for (let i = 0; i < 3; i++) {
        parsedLines.forEach(line => {
          if (line.en) {
            const uEn = new SpeechSynthesisUtterance(line.en);
            uEn.lang = 'en-US'; uEn.rate = 0.9; queue.push(uEn);
          }
          if (line.kr) {
            const uKr = new SpeechSynthesisUtterance(line.kr);
            uKr.lang = 'ko-KR'; uKr.rate = 1.0; queue.push(uKr);
          }
        });
      }

      window.utterances = queue; 

      if (queue.length > 0) {
        queue[queue.length - 1].onend = () => { setIsPlaying(false); setPlayingId(null); };
        queue.forEach(u => { u.onerror = () => { setIsPlaying(false); setPlayingId(null); }; });
        queue.forEach(u => window.speechSynthesis.speak(u));
      } else {
        setIsPlaying(false);
        setPlayingId(null);
      }
    } catch (error) {
      console.error("오디오 재생 에러:", error);
      setNeedExternalBrowser(true);
      setIsPlaying(false);
      setPlayingId(null);
    }
  };

  const openInExternalBrowser = () => {
    const targetUrl = `${window.location.origin}${window.location.pathname}?history_email=${encodeURIComponent(email)}`;
    const userAgent = navigator.userAgent.toLowerCase();
    
    if (userAgent.includes('kakaotalk')) {
      window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(targetUrl);
    } else {
      window.open(targetUrl, '_blank');
    }
    setNeedExternalBrowser(false);
    setAiResult(null); 
  };

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center h-screen bg-emerald-50">
      <div className="text-5xl animate-bounce mb-4">🦜</div>
      <p className="text-emerald-800 font-black text-xl tracking-wider">Parrot Engine Booting...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-emerald-50 relative overflow-hidden flex flex-col items-center justify-center p-4 font-sans pb-20">
      
      {showConfetti && (
        <div className="absolute inset-0 z-50 pointer-events-none flex flex-col items-center justify-center animate-in zoom-in duration-500">
          <div className="text-8xl mb-4 animate-bounce">🎉</div>
          <h2 className="text-4xl font-black text-emerald-600 drop-shadow-md">Welcome to Parrot Diary!</h2>
        </div>
      )}

      {step === 'intro' && !showConfetti && (
        <div className="w-full max-w-xl bg-white rounded-[2.5rem] shadow-xl p-10 relative z-10 animate-in fade-in zoom-in-95 duration-500">
          <div className="text-center space-y-6">
            <div className="text-7xl mb-2">🦜</div>
            <h1 className="text-4xl font-black text-emerald-800 tracking-tight">Parrot Diary</h1>
            <p className="text-gray-500 font-medium">매일매일 재미있게 쓰는 영어 일기장</p>

            <div className="space-y-6 text-left bg-emerald-50/50 p-6 rounded-3xl mt-8">
              <div>
                <label className="block text-sm font-bold text-emerald-700 mb-3 ml-2">💌 내 이메일 주소</label>
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@gmail.com"
                  className="w-full p-4 rounded-2xl border-2 border-emerald-100 focus:border-emerald-400 outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-emerald-700 mb-3 ml-2">✨ 나의 영어 레벨</label>
                <div className="flex gap-2 bg-gray-100 p-1.5 rounded-2xl">
                  {['beginner', 'intermediate', 'advanced'].map(lvl => {
                    const isSelected = currentLevel === lvl;
                    const config = levelConfig[lvl];
                    return (
                      <button 
                        key={lvl}
                        onClick={() => handleLevelChange(lvl)}
                        className={`flex-1 py-3 rounded-xl font-bold transition-all duration-300 flex items-center justify-center
                          ${isSelected ? config.activeClass : 'text-gray-500 hover:bg-emerald-50 hover:text-emerald-700'}`}
                      >
                        {isSelected && <span className="mr-1.5 text-xs">✓</span>}
                        {config.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-8">
              <button 
                onClick={handleStart}
                className="w-full bg-emerald-600 text-white text-xl font-black py-5 rounded-2xl hover:bg-emerald-700 transition-transform active:scale-95 shadow-xl shadow-emerald-200"
              >
                새 일기 쓰기 🚀
              </button>
              
              <button 
                onClick={() => {
                  if (!email.includes('@')) { alert("이메일을 입력해주세요!"); return; }
                  fetchHistory(email);
                }}
                className="w-full bg-pink-50 text-pink-500 text-lg font-bold py-3.5 rounded-2xl hover:bg-pink-100 transition-transform active:scale-95 border-2 border-pink-100"
              >
                나의 영어일기 포트폴리오 📚
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'writing' && (
        <div className="w-full max-w-3xl animate-in slide-in-from-bottom-8 duration-500">
          
          <header className="flex flex-col sm:flex-row justify-between items-center mb-6 bg-white p-4 sm:p-5 rounded-[2rem] shadow-sm border border-emerald-100 gap-3">
            <h1 className="text-xl font-black text-emerald-600 flex items-center gap-2">🦜 Parrot Diary</h1>
            <div className="flex items-center gap-3">
              <button onClick={() => fetchHistory(email)} className="text-sm font-bold text-pink-400 hover:text-pink-600 underline">내 포트폴리오 보기</button>
              <div className="bg-emerald-500 text-white px-4 py-1.5 rounded-full font-bold shadow-md text-sm">⚡ {credits} Credits</div>
            </div>
          </header>

          <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] shadow-xl border border-emerald-50">
            
            <div className="mb-6 text-center sm:text-left">
              <p className="text-[24px] font-black text-[#F97316] mb-2 tracking-tight">오늘의 영어일기 주제</p>
              <h2 className="text-xl font-black text-gray-800 mb-1 leading-snug">{templateData?.theme_kr}</h2>
              <p className="text-sm text-gray-400 font-medium">{templateData?.theme_en}</p>
            </div>

            <div className="flex gap-2 p-1 bg-gray-100 rounded-2xl mb-6">
              {['beginner', 'intermediate', 'advanced'].map(lv => {
                const isSelected = currentLevel === lv;
                const config = levelConfig[lv];
                return (
                  <button 
                    key={lv} 
                    onClick={() => handleLevelChange(lv)} 
                    className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 flex items-center justify-center
                      ${isSelected ? config.activeClass : 'text-gray-500 hover:bg-emerald-50 hover:text-emerald-700'}`}
                  >
                    {isSelected && <span className="mr-1.5 text-xs">✓</span>}
                    {config.label}
                  </button>
                );
              })}
            </div>

            <div className="mb-6">
              <h3 className="text-xs font-bold text-gray-400 mb-2.5">💡 Word Chips</h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.values(templateData?.levels[currentLevel]?.keywords || {}).flat().map((word, i) => (
                  <span key={i} className="bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-xl text-xs font-bold border border-emerald-100">{word}</span>
                ))}
              </div>
            </div>

            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 sm:p-4 rounded-r-2xl mb-4 flex items-start gap-3 shadow-sm">
              <span className="text-xl mt-0.5">✍️</span>
              <div>
                <p className="text-sm sm:text-base font-bold text-yellow-900 leading-tight mb-1">
                  위 단어 중 문맥에 맞는 걸 찾아 아래 빈칸에 올바르게 써 주세요!
                </p>
                <p className="text-xs sm:text-sm text-yellow-700 font-medium leading-snug">
                  ('시제'와 '단수/복수' 등 문맥이 자연스러워지게 써주세요.)
                </p>
              </div>
            </div>

            <textarea
              value={diaryInput}
              onChange={(e) => setDiaryInput(e.target.value)}
              className="w-full h-36 p-6 bg-gray-50 border-2 border-transparent focus:border-emerald-300 focus:bg-white rounded-[2rem] outline-none resize-none text-lg text-gray-700 leading-relaxed shadow-inner transition-all"
              placeholder="템플릿에 맞춰 문장을 완성해보세요!"
            />
            
            <button 
              onClick={handleRewrite}
              disabled={isProcessing || !diaryInput.trim()}
              className="w-full mt-5 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-200 transition-all active:scale-95 text-lg flex justify-center items-center gap-2 disabled:bg-gray-300"
            >
              {isProcessing ? "🦜🎓 Parrot 선생님이 첨삭 중이에요!" : "✨ 선생님에게 제출하기 (-1점)"}
            </button>
          </div>
        </div>
      )}

      {step === 'history' && (
        <div className="w-full max-w-3xl animate-in fade-in zoom-in-95 duration-500">
          <header className="flex flex-col sm:flex-row justify-between items-center mb-6 bg-white p-4 sm:p-6 rounded-[2rem] shadow-sm border border-pink-100 gap-3">
            <h1 className="text-xl sm:text-2xl font-black text-pink-600 flex items-center gap-2">🎓 Dr. Parrot AI 포트폴리오</h1>
            <button onClick={() => setStep('intro')} className="bg-gray-100 text-gray-600 px-5 py-2 rounded-full font-bold hover:bg-gray-200">
              돌아가기
            </button>
          </header>

          <div className="space-y-6">
            {historyList.length === 0 ? (
              <div className="bg-white p-10 rounded-[3rem] text-center shadow-md">
                <p className="text-6xl mb-4">📭</p>
                <h3 className="text-xl font-bold text-gray-600">아직 보관된 일기가 없어요!</h3>
                <p className="text-gray-400 mt-2">새로운 일기를 작성하고 패럿 선생님의 첨삭을 받아보세요.</p>
              </div>
            ) : (
              historyList.map((item, idx) => (
                <div key={item.id} className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-md border-t-8 border-pink-400 relative overflow-hidden">
                  
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="bg-pink-50 text-pink-600 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">{item.level}</span>
                      <p className="text-gray-400 text-xs mt-2 font-medium">작성일: {new Date(item.created_date).toLocaleDateString()}</p>
                    </div>
                    
                    <button 
                      onClick={() => handleListenAndRepeat(item.ai_result, item.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all shadow-sm ${
                        isPlaying && playingId === item.id
                          ? 'bg-red-500 text-white animate-pulse' 
                          : 'bg-gradient-to-r from-pink-400 to-rose-500 text-white hover:scale-105'
                      }`}
                    >
                      {isPlaying && playingId === item.id ? '🛑 정지' : '🎧 듣고 따라하기'}
                    </button>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mb-4">
                    <p className="text-gray-500 text-sm font-bold mb-1">내가 쓴 문장:</p>
                    <p className="text-gray-700 font-medium">{item.original_text}</p>
                  </div>

                  <div className="space-y-2">
                    {item.ai_result.corrected_lines && item.ai_result.corrected_lines.map((line, l_idx) => {
                      const parts = line.split(' / ');
                      return (
                        <div key={l_idx} className="bg-emerald-50 p-3 rounded-xl">
                          <p className="text-emerald-900 font-bold">{parts[0]}</p>
                          <p className="text-emerald-600 text-sm mt-1">{parts[1]}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {aiResult && step === 'writing' && (
        <div className="fixed inset-0 bg-emerald-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[50]">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-6 sm:p-10 shadow-2xl relative animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">
            
            <button onClick={closePopup} className="absolute top-4 sm:top-6 right-4 sm:right-6 text-gray-400 hover:text-gray-600 text-3xl font-black z-10 p-2">✕</button>
            
            <div className="text-center mb-6 sm:mb-8 mt-4 sm:mt-2 shrink-0">
              <div className="relative inline-block mt-4 mb-2">
                <span className="text-7xl block">🦜</span>
                <span className="text-5xl absolute -top-4 -left-3 -rotate-12 z-20 drop-shadow-md">🎓</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-gray-800 uppercase tracking-tighter mt-2">Dr. Parrot's Feedback</h2>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 sm:pr-2 pb-4">
              <div className="bg-emerald-50 p-4 sm:p-6 rounded-3xl mb-6 border-l-8 border-emerald-500">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 border-b border-emerald-200 pb-3">
                  <h3 className="text-emerald-800 font-bold flex items-center gap-1.5 text-lg">
                    <span>⭕</span> Corrected
                  </h3>
                  <button 
                    onClick={() => handleListenAndRepeat(aiResult, 'popup')}
                    className={`w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm ${
                      isPlaying && playingId === 'popup'
                        ? 'bg-red-500 text-white animate-pulse' 
                        : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:scale-105 hover:shadow-md'
                    }`}
                  >
                    {isPlaying && playingId === 'popup' ? '🛑 그만 듣기' : '🎧 Listen & Repeat (3회)'}
                  </button>
                </div>

                <div className="space-y-3">
                  {aiResult.corrected_lines && aiResult.corrected_lines.map((line, idx) => {
                    const parts = line.split(' / ');
                    return (
                      <div key={idx} className="bg-white p-3 rounded-xl border border-emerald-100">
                        <div className="text-emerald-900 font-bold text-lg">{parts[0]}</div>
                        <div className="text-emerald-600 text-sm mt-1">{parts[1]}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4">
                {aiResult.mom_guide && (
                  <div className="flex gap-4 bg-purple-50 p-4 sm:p-5 rounded-3xl flex-col sm:flex-row">
                    <div className="text-purple-600 w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-xl bg-purple-100">👩‍🏫</div>
                    <div>
                      <h4 className="font-bold text-purple-900 mb-1">어머니 가이드</h4>
                      <p className="text-purple-800 text-sm leading-relaxed">{aiResult.mom_guide}</p>
                    </div>
                  </div>
                )}

                {aiResult.vivid_expression && (
                  <div className="flex gap-4 bg-orange-50 p-4 sm:p-5 rounded-3xl flex-col sm:flex-row">
                    <div className="text-orange-600 w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-xl bg-orange-100">💡</div>
                    <div>
                      <h4 className="font-bold text-orange-900 mb-1">더 생생한 원어민 표현</h4>
                      <p className="text-orange-800 font-bold mb-1">"{aiResult.vivid_expression.expression}"</p>
                      <p className="text-orange-700 text-sm leading-relaxed">{aiResult.vivid_expression.why}</p>
                    </div>
                  </div>
                )}

                {aiResult.expression && (
                  <div className="flex gap-4 bg-blue-50 p-4 sm:p-5 rounded-3xl flex-col sm:flex-row">
                    <div className="text-blue-600 w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-xl bg-blue-100">📖</div>
                    <div className="w-full">
                      <h4 className="font-bold text-blue-900 mb-2">핵심 영단어</h4>
                      <ul className="space-y-2">
                        {Object.entries(aiResult.expression).map(([k, v], idx) => (
                          <li key={idx} className="text-sm bg-white px-3 py-2 rounded-lg border border-blue-100">
                            <strong className="text-blue-700">{k}</strong> : <span className="text-blue-600">{v}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {aiResult.tip && (
                  <div className="flex gap-4 bg-pink-50 p-4 sm:p-5 rounded-3xl flex-col sm:flex-row">
                    <div className="text-pink-600 w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-xl bg-pink-100">✨</div>
                    <div>
                      <h4 className="font-bold text-pink-900 mb-1">선생님의 한마디</h4>
                      <p className="text-pink-800 text-sm leading-relaxed">{aiResult.tip}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 bg-gradient-to-r from-emerald-600 to-teal-700 rounded-3xl p-6 shadow-xl relative overflow-hidden border border-emerald-400">
                <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white opacity-10 rounded-full blur-xl"></div>
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4 border-b border-emerald-500 pb-3">
                    <span className="text-3xl sm:text-4xl animate-bounce">💌</span>
                    <h4 className="font-extrabold text-lg sm:text-xl text-white tracking-tight">
                      잠깐! 더 자세한 내용은 이메일을 확인하세요!
                    </h4>
                  </div>
                  <p className="text-emerald-50 text-sm sm:text-[15px] leading-relaxed font-medium break-keep">
                    보내드리는 이메일의 <strong className="text-yellow-300 underline decoration-yellow-300/50 underline-offset-4 font-extrabold">'Dr. Parrot AI + Human 선생님'</strong>의 <strong className="text-yellow-300 font-extrabold">'전문 첨삭 콘텐츠'</strong>는 
                    내 아이만을 위한 소중한 <span className="bg-emerald-900/60 px-2 py-0.5 rounded-md text-white border border-emerald-500 inline-block mt-1 sm:mt-0 font-bold">맞춤형 참고서 DB</span> 겸 
                    아이의 <span className="bg-emerald-900/60 px-2 py-0.5 rounded-md text-white border border-emerald-500 inline-block mt-1 sm:mt-0 font-bold">학습 포트폴리오</span>로 완벽하게 활용될 수 있답니다. 
                    <br/><span className="block mt-5 font-bold text-white text-[15px] sm:text-base bg-emerald-800/80 p-3 sm:p-4 rounded-xl border border-emerald-500 text-center shadow-inner">지금 바로 메일함을 열어 프리미엄 강좌를 확인해 보세요! 🏃‍♀️💨</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="shrink-0 mt-2 sm:mt-4 pt-4 border-t border-gray-100">
              <button onClick={closePopup} className="w-full bg-gray-900 text-white font-black py-4 sm:py-5 rounded-2xl hover:bg-black transition-colors shadow-lg shadow-gray-200 text-lg">
                확인했어요!
              </button>
            </div>

          </div>
        </div>
      )}

      {needExternalBrowser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95">
            <div className="text-6xl mb-4">😢</div>
            <h3 className="text-2xl font-black text-gray-800 mb-2">소리를 들을 수 없어요!</h3>
            <p className="text-gray-500 font-medium text-sm mb-6 leading-relaxed">
              카카오톡에서는 음성 기능을 지원하지 않아요.<br/>아래 버튼을 누르면 <strong>Dr. Parrot AI의 포트폴리오</strong>(크롬/사파리)로 이동해서 맘껏 들을 수 있습니다!
            </p>

            <button 
              onClick={openInExternalBrowser}
              className="w-full bg-blue-600 text-white text-lg font-black py-4 rounded-xl mb-3 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
            >
              🎓 내 포트폴리오로 이동하기
            </button>

            <button 
              onClick={() => setNeedExternalBrowser(false)}
              className="w-full bg-gray-100 text-gray-600 font-bold py-3 rounded-xl hover:bg-gray-200 transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default ParrotFrontApp;