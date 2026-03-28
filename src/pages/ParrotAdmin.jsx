import React, { useState } from 'react';
import { db } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';

const ParrotBackoffice = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isUploading, setIsUploading] = useState(false);

  const uploadDummyData = async () => {
    setIsUploading(true);
    try {
      const dummyTemplate = {
        theme_en: "A rainy day at home",
        theme_kr: "비 오는 날 집에서",
        levels: {
          beginner: {
            template: ["It is [blank_1_weather].", "I am [blank_2_feeling].", "I [blank_3_action] at [blank_4_place].", "I [blank_5_action] with [blank_6_person]."],
            keywords: {
              "blank_1_weather": ["sunny", "rainy", "cloudy"], "blank_2_feeling": ["happy", "bored", "sleepy"],
              "blank_3_action": ["play", "read", "sleep"], "blank_4_place": ["home", "room"],
              "blank_5_action": ["play", "talk"], "blank_6_person": ["mom", "brother", "dog"]
            }
          },
          intermediate: {
            template: ["It was [blank_1_weather] today.", "Today, I [blank_2_summary].", "I [blank_3_action] at [blank_4_place].", "I [blank_5_action] with [blank_6_person] and I felt [blank_7_feeling].", "I liked it because [blank_8_reason]. / I did not like it because [blank_9_reason]."],
            keywords: {
              "blank_1_weather": ["rainy", "cold"], "blank_2_summary": ["stay at home", "rest all day"],
              "blank_3_action": ["watch TV", "read a book"], "blank_4_place": ["living room", "bed"],
              "blank_5_action": ["play board games", "eat snacks"], "blank_6_person": ["family", "sister"],
              "blank_7_feeling": ["excited", "cozy"], "blank_8_reason": ["it be fun", "I can relax"],
              "blank_9_reason": ["I can not go out", "it be boring"]
            }
          },
          advanced: {
            template: ["The weather was [blank_1_weather], so I decided to [blank_2_action].", "I [blank_3_action] hard, but it was [blank_4_feeling].", "I met [blank_5_person], and I asked, 'Why are you [blank_6_action]?'", "He/She answered that [blank_7_indirect], because [blank_8_reason].", "Finally, we [blank_9_action], and it made me feel [blank_10_feeling]."],
            keywords: {
              "blank_1_weather": ["rainy heavily", "gloomy"], "blank_2_action": ["stay indoors", "clean my room"],
              "blank_3_action": ["study math", "read a thick book"], "blank_4_feeling": ["difficult", "a bit boring"],
              "blank_5_person": ["my mom", "my brother"], "blank_6_action": ["look so busy", "pack bags"],
              "blank_7_indirect": ["they need to go out", "they have a plan"], "blank_8_reason": ["they have an appointment", "it be important"],
              "blank_9_action": ["order pizza", "watch a movie together"], "blank_10_feeling": ["happy", "relaxed"]
            }
          }
        },
        createdAt: new Date()
      };
      await setDoc(doc(db, "parrot_templates", "theme_001"), dummyTemplate);
      alert("✅ 성공적으로 DB에 템플릿이 적재되었습니다!");
    } catch (error) {
      alert("❌ 에러 발생: " + error.message);
    }
    setIsUploading(false);
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans text-gray-800">
      <div className="w-64 bg-slate-900 text-white flex flex-col shadow-xl">
        <div className="p-6 text-2xl font-black text-emerald-400 border-b border-slate-800">🦜 Parrot Admin</div>
        <nav className="flex-1 p-4 flex flex-col gap-2">
          <button onClick={() => setActiveTab('dashboard')} className={`p-3 text-left rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-emerald-600 font-bold' : 'hover:bg-slate-800 text-slate-400'}`}>📊 대시보드</button>
          <button onClick={() => setActiveTab('templates')} className={`p-3 text-left rounded-xl transition-all ${activeTab === 'templates' ? 'bg-emerald-600 font-bold' : 'hover:bg-slate-800 text-slate-400'}`}>📚 템플릿 관리 (DB)</button>
        </nav>
      </div>
      <div className="flex-1 p-10 overflow-y-auto">
        {activeTab === 'templates' && (
          <div>
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-3xl font-bold">템플릿 DB 공장</h2>
              <button onClick={uploadDummyData} disabled={isUploading} className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all active:scale-95">
                {isUploading ? "🚀 쏘는 중..." : "🔥 DB에 테스트 템플릿 쏘기 (Click!)"}
              </button>
            </div>
            <div className="bg-white p-12 rounded-3xl shadow-sm border border-slate-100 text-center">
              <div className="text-6xl mb-4">🏭</div>
              <p className="text-slate-700 text-xl font-bold">초록색 버튼을 눌러보세요!</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ParrotBackoffice;