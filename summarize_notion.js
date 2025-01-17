/*******************************************************
 * Notion「タイトル型＋本文ブロック」の両方をまとめてDeepSeek要約
 *  → 「Article Summary」に書き込む
 *  1) 既にSummaryがある場合は上書きしない
 *  2) タイトル(Article Title)＋本文ブロックを合体
 *  3) 再帰でブロックを取得し、すべてのplain_textを結合
 *  4) DeepSeek APIへ
 *  5) 結果を Article Summary へ保存
 *******************************************************/
function summarizeNotionPageContent() {
    Logger.log("===== 開始: Notionページを要約し 'Article Summary' に書き込む =====");
    try {
      // ★ 設定箇所 ★
      const NOTION_API_TOKEN = “【インテグレーションのシークレットキーを入れる】";
      const NOTION_DB_ID     = “【notionのdb idを入れる】";
      const DEEPSEEK_API_KEY = “【deepseekのapiキーを入れる】";
  
      // 1) "Article Summary" が空のページをすべて取得 (既存要約の上書き回避)
      Logger.log("ステップ1: Article Summary が空のページをクエリします...");
      const targetPages = queryAllPagesWithEmptySummary(NOTION_DB_ID, NOTION_API_TOKEN);
      Logger.log(`  => 該当ページ数: ${targetPages.length}`);
  
      let updatedCount = 0, skippedCount = 0;
  
      // 2) 各ページを処理
      for (let i = 0; i < targetPages.length; i++) {
        const page = targetPages[i];
        const pageId = page.id;
  
        // タイトル（Article Title / title型）を文字列化（見出し的テキスト）
        const articleTitleText = getTitleValue(page.properties["Article Title"]) || "";
  
        // 念のため2重チェック：もし「Article Summary」がもう埋まっていたらスキップ
        const currSummary = getRichTextValue(page.properties["Article Summary"]) || "";
        if (currSummary.trim() !== "") {
          Logger.log(`[${i+1}/${targetPages.length}] PageID=${pageId} / 既にSummaryが存在 => スキップ`);
          skippedCount++;
          continue;
        }
  
        Logger.log(`[${i+1}/${targetPages.length}] PageID=${pageId} / Title="${articleTitleText}"`);
  
        // 3) 本文ブロックを再帰取得
        Logger.log("  -> ブロック内容を取得...");
        const pageBodyText = getAllBlocksText(pageId, NOTION_API_TOKEN);
  
        // 4) タイトル + 本文ブロック をまとめて結合
        //    もし本文が空ならタイトルのみ, タイトルが空なら本文のみ, 両方あれば両方
        let combinedText = "";
        if (articleTitleText.trim()) {
          combinedText += `【タイトル】\n${articleTitleText}\n`;
        }
        if (pageBodyText.trim()) {
          combinedText += `\n【本文】\n${pageBodyText}\n`;
        }
  
        if (!combinedText.trim()) {
          // タイトルも本文も空 => 要約不可
          Logger.log("  -> タイトルも本文も空なのでスキップ");
          skippedCount++;
          continue;
        }
  
        // 5) DeepSeekで要約
        Logger.log("  -> DeepSeekで要約開始...");
        const summary = callDeepSeekSummaryApi(DEEPSEEK_API_KEY, combinedText);
        if (!summary.trim()) {
          Logger.log("  -> 要約結果が空 => スキップ");
          skippedCount++;
          continue;
        }
        Logger.log("  -> 要約結果:\n" + summary);
  
        // 6) Notion に書き込み (PATCH)
        Logger.log("  -> Notion に書き込み中...");
        const ok = updateArticleSummary(NOTION_API_TOKEN, pageId, summary);
        if (ok) {
          Logger.log("  -> 成功");
          updatedCount++;
        } else {
          Logger.log("  -> 更新失敗");
        }
      }
  
      Logger.log(`===== 終了 => Updated=${updatedCount}, Skipped=${skippedCount} =====`);
    } catch (err) {
      Logger.log("【エラー】" + err);
    }
  }
  
  /**
   * (A) "Article Summary" が空のページを全取得 (ページング対応)
   */
  function queryAllPagesWithEmptySummary(dbId, notionToken) {
    const resultPages = [];
    let hasMore = true;
    let startCursor = undefined;
  
    const filter = {
      property: "Article Summary",
      rich_text: { equals: "" }
    };
  
    while (hasMore) {
      const payload = { filter, page_size: 100 };
      if (startCursor) {
        payload.start_cursor = startCursor;
      }
  
      const res = callNotionAPI(`/v1/databases/${dbId}/query`, "post", notionToken, payload);
      if (!res) {
        Logger.log("queryAllPagesWithEmptySummary: Nullレス => 中断");
        break;
      }
  
      const results = res.results || [];
      resultPages.push(...results);
  
      hasMore = res.has_more || false;
      startCursor = res.next_cursor;
      Logger.log(`  => クエリで ${results.length} 件取得, hasMore=${hasMore}`);
    }
  
    return resultPages;
  }
  
  /**
   * (B) 指定ページIDのブロックを再帰取得し、plain_textをまとめて返す
   */
  function getAllBlocksText(blockId, notionToken) {
    const textParts = [];
    fetchBlocksRecursively(blockId, notionToken, textParts);
    return textParts.join("\n");
  }
  
  function fetchBlocksRecursively(blockId, notionToken, textHolder, startCursor) {
    let path = `/v1/blocks/${blockId}/children?page_size=100`;
    if (startCursor) {
      path += `&start_cursor=${startCursor}`;
    }
  
    const res = callNotionAPI(path, "get", notionToken);
    if (!res) {
      Logger.log(`fetchBlocksRecursively: null応答 blockId=${blockId}`);
      return;
    }
  
    const results = res.results || [];
    for (const block of results) {
      const bType = block.type;
      // テキスト抽出
      const lines = getBlockText(block, bType);
      if (lines.length > 0) {
        textHolder.push(...lines);
      }
      // has_children = true なら下階層を再帰
      if (block.has_children) {
        fetchBlocksRecursively(block.id, notionToken, textHolder);
      }
    }
  
    // ページング
    if (res.has_more && res.next_cursor) {
      fetchBlocksRecursively(blockId, notionToken, textHolder, res.next_cursor);
    }
  }
  
  /**
   * ブロックからplain_textを取り出し1行として返す
   */
  function getBlockText(block, bType) {
    if (!block[bType]) return [];
    const data = block[bType];
    if (!data.rich_text) return [];
    const arr = data.rich_text;
    const lines = arr.map(x => x.plain_text || "").filter(s => s);
    if (lines.length > 0) {
      return [ lines.join("") ];
    }
    return [];
  }
  
  /**
   * (C) DeepSeek要約
   */
  function callDeepSeekSummaryApi(deepseekKey, text) {
    try {
      const systemPrompt = `
  あなたはニュース記事を短文で要約するアシスタントです。
  以下のルールを厳密に守って要約してください:
  
  1. 出力は日本語で行う
  2. 全文で約140字以内を目安にする
  3. 事実にないことは絶対に書かない
  4. 文末表現はなるべく省略し、簡潔にする
  5. 以下の文体例と同様のスタイルで、テレグラフ風に事実を伝える
  
  # 文体の例（要素分解済み）
  - 「GitHub Copilot Workspaceのウェイティングリストが廃止。自然言語で、Issue対応、PRの作成、プロジェクトの立ち上げなどをCopilot Workspaceがサポートしてくれる」
  - 「Perplexityが試合スケジュール、プレイごとの詳細分析をリアルタイムで提供する『Perplexity Sports』を開始。最初はNBAとNFLに対応し、今後さらに多くのスポーツ情報をサポート予定」
  - 「OpenAIがワシントンDCと主要な2つの激戦州でイベントを開催し、AI投資への支持を強化する計画を発表。さらにアメリカが中国にAI分野で遅れを取らないようにするために、官民連携を呼びかける『経済青写真』を発表」
  - 「2日前に投稿されたポッドキャストでもSalesforce CEOが、AIエージェントによる生産性の大幅な向上を理由に、2025年のソフトウェアエンジニアの新規採用を見送ると話している」
  - 「NVIDIAがバイデン政権のAIチップに対する輸出制限を批判している。イノベーションを阻害し、米国の技術的リーダーシップを損なうと主張。さらに、トランプ政権がAI分野における米国の成功の基盤を築いたと評価している」
  
  上記の文体例の特徴:
  - 見出し調、または短文を複数つなげたスタイル
  - 句点や語尾の終止表現を簡潔にし、または省略
  - 事実ベースで要点のみを伝える
  - 文字数(全角換算)は約140字以内
  
  指定したテキストを、このスタイル・ルールで要約してください。
  `.trim();
  
      const userPrompt = `以下のテキストを指定したスタイル・ルールで140字以内で要約してください:\n${text}`;
  
      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt }
      ];
  
      const payload = {
        model: "deepseek-chat",
        messages,
        temperature: 0.7,
        max_tokens: 200
      };
  
      const headers = {
        "Authorization": `Bearer ${deepseekKey}`,
        "Content-Type": "application/json"
      };
  
      const options = {
        method: "post",
        headers,
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
  
      const response = UrlFetchApp.fetch("https://api.deepseek.com/chat/completions", options);
      const code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        const json = JSON.parse(response.getContentText());
        return json?.choices?.[0]?.message?.content?.trim() || "";
      } else {
        Logger.log(`DeepSeek API Error: code=${code}, body=${response.getContentText()}`);
        return "";
      }
    } catch (err) {
      Logger.log(`callDeepSeekSummaryApi exception: ${err}`);
      return "";
    }
  }
  
  /**
   * (D) Notionに Article Summary を書き込む (PATCH /v1/pages/{pageId})
   */
  function updateArticleSummary(notionToken, pageId, summary) {
    const body = {
      properties: {
        "Article Summary": {
          rich_text: [
            {
              type: "text",
              text: { content: summary }
            }
          ]
        }
      }
    };
    const res = callNotionAPI(`/v1/pages/${pageId}`, "patch", notionToken, body);
    if (!res) {
      Logger.log("updateArticleSummary: null応答 => 失敗");
      return false;
    }
    if (res.id) {
      return true;
    }
    return false;
  }
  
  
  /**
   * (E) Notion API 呼び出し
   */
  function callNotionAPI(path, method, token, payloadObj) {
    const baseUrl = "https://api.notion.com";
    let url = baseUrl + path;
  
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    };
    const options = {
      method,
      headers,
      muteHttpExceptions: true
    };
    if (payloadObj && (method === "post" || method === "patch")) {
      options.payload = JSON.stringify(payloadObj);
    }
  
    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        return JSON.parse(response.getContentText());
      } else {
        Logger.log(`Notion API Error [${method.toUpperCase()} ${path}]: code=${code}, body=${response.getContentText()}`);
        return null;
      }
    } catch (err) {
      Logger.log(`Notion API Exception [${method.toUpperCase()} ${path}]: ${err}`);
      return null;
    }
  }
  
  /**
   * (F) タイトル型プロパティから文字列を取り出す
   */
  function getTitleValue(titleProp) {
    if (!titleProp || !titleProp.title) return "";
    return titleProp.title.map(x => x.plain_text || "").join("");
  }
  
  /**
   * (G) rich_text型プロパティから文字列を取り出す
   */
  function getRichTextValue(richProp) {
    if (!richProp || !richProp.rich_text) return "";
    return richProp.rich_text.map(x => x.plain_text || "").join("");
  }