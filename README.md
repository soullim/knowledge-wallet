# 웹디자인팀 포털

업무 대시보드 + 지식지갑 통합 포털입니다.

## 📁 파일 구조
```
/
├── index.html   ← 포털 메인 (대시보드 + 지식지갑 통합)
├── news.json    ← 지식지갑 뉴스 데이터 (수동 업데이트)
└── README.md
```

## 🚀 GitHub Pages 배포
1. 레포 생성 (Public)
2. 파일 업로드
3. Settings → Pages → Branch: main / (root) → Save
4. 1~2분 후 `https://{계정}.github.io/{레포명}/` 활성화

## 📰 news.json 업데이트 방법
news.json 파일을 수정해 업로드하면 지식지갑 내용이 갱신됩니다.

```json
{
  "updated": "2026.05.08",
  "articles": [
    {
      "category": "figma",
      "title": "기사 제목",
      "summary": "한 줄 요약",
      "summary_full": "상세 내용 (문장 단위로 분리됩니다)",
      "keywords": ["키워드1", "키워드2"],
      "source": "출처",
      "date": "5월 8일",
      "url": "https://...",
      "collectedAt": "2026-05-08"
    }
  ]
}
```

카테고리: figma / adobe / ai / frontend / industry / design / trend

## ⚙️ 레드마인 설정
사이트 접속 후 레드마인 영역 → [API 설정] 에서 입력
- API Key는 각자 로컬에 저장 (공유 안 됨)
