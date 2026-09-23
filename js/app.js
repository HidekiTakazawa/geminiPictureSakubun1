/**
 * 中国語写真作文 - フロントエンド Vue 3 アプリケーションロジック
 */

const { createApp, ref, computed, onMounted, nextTick } = Vue;

createApp({
  setup() {
    // 状態管理
    const configGasUrl = (typeof CONFIG !== 'undefined' && CONFIG.GAS_URL) ? CONFIG.GAS_URL.trim() : '';
    const storedGasUrl = localStorage.getItem('cn_photo_essay_gas_url');
    // localStorageに設定があればそれを優先、なければconfig.jsの設定を使用
    const gasUrl = ref(storedGasUrl !== null ? storedGasUrl : configGasUrl);
    const tempGasUrl = ref(gasUrl.value);
    const isDarkTheme = ref(localStorage.getItem('cn_photo_essay_theme') === 'dark');
    const isDemoMode = ref(!gasUrl.value);
    const showSettingsModal = ref(false);
    const isTestingConnection = ref(false);
    const spreadsheetUrl = ref(localStorage.getItem('cn_photo_essay_ss_url') || '');
    const driveFolderUrl = ref(localStorage.getItem('cn_photo_essay_folder_url') || '');

    // 画像・解析状態
    const currentImage = ref(null); // { base64, mimeType, name, previewUrl, fromDrive, fileId, fileUrl }
    const isAnalyzing = ref(false);
    const analysisData = ref(null);
    const driveInfo = ref(null);
    const isFromCache = ref(false); // スプレッドシートキャッシュから取得したかどうか

    // Google Drive ギャラリー状態
    const showDriveModal = ref(false);
    const driveFiles = ref([]);
    const isLoadingDriveFiles = ref(false);
    const isLoadingDriveImage = ref(false);

    // 作文・添削状態
    const userEssay = ref('');
    const isCheckingEssay = ref(false);
    const correctionData = ref(null);

    // UIタブ
    const activeTab = ref('words'); // 'words' | 'model' | 'correction'
    const modelLevel = ref('beginner'); // 'beginner' | 'intermediate'
    const essayTextarea = ref(null);

    // トースト通知
    const toasts = ref([]);
    const showToast = (message, type = 'info') => {
      const id = Date.now() + Math.random();
      toasts.value.push({ id, message, type });
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 4500);
    };

    // 初期化
    onMounted(() => {
      if (isDarkTheme.value) {
        document.body.classList.add('dark-theme');
      }
      // サンプル画像を初期セットして使いやすさを向上
      loadSamplePreset('cafe');

      // GAS接続がある場合はスプレッドシート情報やDrive画像一覧をバックグラウンド先読み（即時表示用）
      if (gasUrl.value) {
        fetchAppInfo();
        fetchDriveFiles(true); // サイレント先読み
      }
    });

    // アプリ情報（スプレッドシートURL等）の取得
    const fetchAppInfo = async () => {
      if (!gasUrl.value) return;
      try {
        const response = await fetch(gasUrl.value, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'get_app_info' }),
          redirect: 'follow'
        });
        const res = await response.json();
        if (res.status === 'success') {
          if (res.spreadsheetUrl) {
            spreadsheetUrl.value = res.spreadsheetUrl;
            localStorage.setItem('cn_photo_essay_ss_url', res.spreadsheetUrl);
          }
          if (res.folderUrl) {
            driveFolderUrl.value = res.folderUrl;
            localStorage.setItem('cn_photo_essay_folder_url', res.folderUrl);
          }
        }
      } catch (e) {
        console.warn('App info fetch error (non-blocking):', e);
      }
    };

    // テーマ切り替え
    const toggleTheme = () => {
      isDarkTheme.value = !isDarkTheme.value;
      if (isDarkTheme.value) {
        document.body.classList.add('dark-theme');
        localStorage.setItem('cn_photo_essay_theme', 'dark');
      } else {
        document.body.classList.remove('dark-theme');
        localStorage.setItem('cn_photo_essay_theme', 'light');
      }
    };

    // 設定モーダル
    const openSettings = () => {
      tempGasUrl.value = gasUrl.value;
      showSettingsModal.value = true;
    };

    const closeSettings = () => {
      showSettingsModal.value = false;
    };

    const saveSettings = () => {
      gasUrl.value = tempGasUrl.value.trim();
      localStorage.setItem('cn_photo_essay_gas_url', gasUrl.value);
      if (gasUrl.value) {
        isDemoMode.value = false;
        showToast('GASのWebアプリURLを保存しました', 'success');
        fetchAppInfo();
      } else {
        isDemoMode.value = true;
        showToast('GAS URLが未設定のため、デモモードで動作します', 'info');
      }
      closeSettings();
    };

    const applyConfigGasUrl = () => {
      if (configGasUrl) {
        tempGasUrl.value = configGasUrl;
        showToast('config.jsで指定されたGAS URLを読み込みました', 'info');
      }
    };

    const clearCustomGasUrl = () => {
      localStorage.removeItem('cn_photo_essay_gas_url');
      gasUrl.value = configGasUrl;
      tempGasUrl.value = configGasUrl;
      isDemoMode.value = !configGasUrl;
      showToast('ブラウザ保存URLをクリアし、config.jsの初期設定に戻しました', 'info');
      closeSettings();
      if (configGasUrl) fetchAppInfo();
    };

    // GAS接続テスト
    const testGasConnection = async () => {
      if (!tempGasUrl.value.trim()) {
        showToast('GASのURLを入力してください', 'error');
        return;
      }
      isTestingConnection.value = true;
      try {
        const response = await fetch(tempGasUrl.value.trim(), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'test_connection' }),
          redirect: 'follow'
        });
        const res = await response.json();
        if (res.status === 'success') {
          if (res.spreadsheetUrl) {
            spreadsheetUrl.value = res.spreadsheetUrl;
            localStorage.setItem('cn_photo_essay_ss_url', res.spreadsheetUrl);
          }
          if (res.folderUrl) {
            driveFolderUrl.value = res.folderUrl;
            localStorage.setItem('cn_photo_essay_folder_url', res.folderUrl);
          }
          showToast('接続成功！Gemini API・Google Driveフォルダ・スプレッドシート連携が正常です。', 'success');
        } else {
          showToast(res.message || '接続エラーが発生しました', 'error');
        }
      } catch (err) {
        console.error('GAS connection error:', err);
        showToast(`接続エラー: ${err.message || 'CORSまたは権限承認を確認してください'}`, 'error');
      } finally {
        isTestingConnection.value = false;
      }
    };

    // 画像選択・ドロップ処理
    const handleFileChange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) processFile(file);
    };

    const handleDrop = (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        processFile(file);
      }
    };

    // 画像のリサイズ・圧縮＆Base64変換（高速化のため最大幅800px & 0.80クオリティに最適化）
    const processFile = (file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // 高速通信 & Vision最適化のため最大800pxにリサイズ
          const maxDim = 800;
          let width = img.width;
          let height = img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const mimeType = 'image/jpeg';
          const base64 = canvas.toDataURL(mimeType, 0.80);

          currentImage.value = {
            base64: base64,
            mimeType: mimeType,
            name: file.name,
            previewUrl: base64
          };

          // 以前の解析結果をリセット
          analysisData.value = null;
          correctionData.value = null;
          driveInfo.value = null;
          isFromCache.value = false;
          userEssay.value = '';

          showToast('画像を読み込みました。「✨ AIで画像を解析」を押してください', 'info');
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    };

    // Google Drive モーダル開く（キャッシュがあれば即時0秒で表示）
    const openDriveModal = async () => {
      showDriveModal.value = true;
      // すでに一覧が取得済みであれば即時表示し、裏側で最新化（または再読み込みボタンで更新）
      if (!driveFiles.value || driveFiles.value.length === 0) {
        await fetchDriveFiles(false);
      } else {
        // バックグラウンドで静かに最新化
        fetchDriveFiles(true);
      }
    };

    const closeDriveModal = () => {
      showDriveModal.value = false;
    };

    // Google Drive から画像一覧を取得 (silent: true の場合はローディング画面を出さずに更新)
    const fetchDriveFiles = async (silent = false) => {
      if (!silent) {
        isLoadingDriveFiles.value = true;
      }

      if (isDemoMode.value || !gasUrl.value) {
        setTimeout(() => {
          driveFiles.value = [
            { id: 'demo-1', name: 'photo_cafe_sample.jpg', dateCreated: '2026/09/22 14:30', size: 1048576, type: 'cafe', hasCache: true, sceneDescription: 'カフェのコーヒーと本' },
            { id: 'demo-2', name: 'photo_park_sample.jpg', dateCreated: '2026/09/21 10:15', size: 2097152, type: 'park', hasCache: true, sceneDescription: '公園の木とベンチ' }
          ];
          isLoadingDriveFiles.value = false;
        }, 200);
        return;
      }

      try {
        const response = await fetch(gasUrl.value, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'list_drive_images' }),
          redirect: 'follow'
        });
        const res = await response.json();
        if (res.status === 'success' && res.data) {
          driveFiles.value = res.data.files || [];
        } else if (!silent) {
          showToast(res.message || 'Drive画像の取得に失敗しました', 'error');
        }
      } catch (err) {
        console.error('Drive files fetch error:', err);
        if (!silent) {
          showToast('Drive画像の取得に失敗しました: ' + err.message, 'error');
        }
      } finally {
        isLoadingDriveFiles.value = false;
      }
    };

    // Google Drive から画像を選択してロード (即時0秒オプティミスティック表示 & 解析データ一括ロード)
    const selectDriveFile = async (file) => {
      if (isDemoMode.value || !gasUrl.value) {
        loadSamplePreset(file.type || 'cafe');
        closeDriveModal();
        showToast(`Driveから「${file.name}」を読み込みました`, 'success');
        return;
      }

      // 1. 【即時表示】クリックされた瞬間に高速サムネイルURLを使って画面に即座（0秒）に画像を表示＆モーダルを閉じる！
      const fastPreviewUrl = file.thumbnailUrl ? file.thumbnailUrl.replace('sz=w300', 'sz=w1000') : `https://drive.google.com/thumbnail?id=${file.id}&sz=w1000`;
      
      currentImage.value = {
        base64: fastPreviewUrl,
        mimeType: file.mimeType || 'image/jpeg',
        name: file.name,
        previewUrl: fastPreviewUrl,
        fromDrive: true,
        fileId: file.id,
        fileUrl: file.url || ''
      };

      driveInfo.value = {
        saved: true,
        fileName: file.name,
        fileUrl: file.url || '',
        isExisting: true
      };

      // 前回の解析データ・添削データを即座にリセット（前の画像の単語が残らないようにする）
      analysisData.value = null;
      isFromCache.value = false;
      correctionData.value = null;
      userEssay.value = '';

      // モーダルを即座に閉じる（待ち時間なし！）
      closeDriveModal();

      // 2. バックグラウンドで完全な画像データとスプレッドシートの解析キャッシュを取得
      isLoadingDriveImage.value = true;
      try {
        const response = await fetch(gasUrl.value, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'load_drive_image',
            fileId: file.id
          }),
          redirect: 'follow'
        });
        const res = await response.json();
        if (res.status === 'success' && res.data) {
          // 本体のBase64データがあれば更新
          if (res.data.base64) {
            currentImage.value.base64 = res.data.base64;
          }
          if (res.data.fileName) {
            currentImage.value.name = res.data.fileName;
          }

          // 解析済みキャッシュデータがあれば即座に単語・例文・模範作文を展開！
          if (res.data.analysis) {
            analysisData.value = res.data.analysis;
            isFromCache.value = true;
            activeTab.value = 'words';
            showToast(`⚡「${file.name}」の解析データをスプレッドシートから読み込みました！`, 'success');
          } else {
            analysisData.value = null;
            isFromCache.value = false;
            showToast(`「${file.name}」を読み込みました。「✨ AIで画像を解析」を押してください`, 'info');
          }
        } else {
          console.warn('Drive image detail fetch warning:', res.message);
        }
      } catch (err) {
        console.warn('Load drive image background warning:', err);
      } finally {
        isLoadingDriveImage.value = false;
      }
    };

    // 画像解析リクエスト (forceReanalyze: true でキャッシュを無視してGeminiで再生成)
    const analyzeImage = async (forceReanalyze = false) => {
      if (!currentImage.value) return;

      isAnalyzing.value = true;
      activeTab.value = 'words';

      if (isDemoMode.value || !gasUrl.value) {
        // デモモード（即時サンプルデータ提供）
        setTimeout(() => {
          analysisData.value = getDemoAnalysis();
          driveInfo.value = {
            saved: true,
            fileName: currentImage.value.name || 'sample_cafe_demo.jpg',
            folderName: '中国語写真作文_Images (Demo)'
          };
          isFromCache.value = !forceReanalyze;
          isAnalyzing.value = false;
          showToast(forceReanalyze ? '【デモモード】AIで再解析しました' : '【デモモード】画像解析が完了しました', 'success');
        }, 800);
        return;
      }

      try {
        const payload = {
          action: 'analyze_image',
          imageBase64: currentImage.value.base64,
          mimeType: currentImage.value.mimeType,
          fileName: currentImage.value.name,
          fromDrive: !!currentImage.value.fromDrive,
          fileId: currentImage.value.fileId || '',
          fileUrl: currentImage.value.fileUrl || '',
          forceReanalyze: !!forceReanalyze
        };

        const response = await fetch(gasUrl.value, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow'
        });

        const res = await response.json();
        if (res.status === 'success' && res.data) {
          analysisData.value = res.data.analysis;
          driveInfo.value = res.data.drive;
          isFromCache.value = !!res.data.cached;
          if (res.data.spreadsheetUrl) {
            spreadsheetUrl.value = res.data.spreadsheetUrl;
            localStorage.setItem('cn_photo_essay_ss_url', res.data.spreadsheetUrl);
          }

          if (res.data.cached) {
            showToast('⚡ スプレッドシートのキャッシュから高速読み込みしました！（約0.5秒）', 'success');
          } else {
            showToast('✨ Geminiによる画像解析が完了し、スプレッドシートに保存しました！', 'success');
          }
        } else {
          showToast(res.message || '解析に失敗しました', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('通信エラーが発生しました: ' + err.message, 'error');
      } finally {
        isAnalyzing.value = false;
      }
    };

    // 作文添削リクエスト
    const checkEssay = async () => {
      if (!userEssay.value.trim()) {
        showToast('作文を入力してください', 'warning');
        return;
      }

      isCheckingEssay.value = true;
      activeTab.value = 'correction';

      if (isDemoMode.value || !gasUrl.value) {
        // デモモード添削
        setTimeout(() => {
          correctionData.value = getDemoCorrection(userEssay.value);
          isCheckingEssay.value = false;
          showToast('【デモモード】添削が完了しました', 'success');
        }, 1000);
        return;
      }

      try {
        // 画像コンテキスト（抽出された単語やシーン概要）を付与
        let imageContext = '';
        if (analysisData.value) {
          imageContext = `画像概要: ${analysisData.value.scene_description_ja || ''}\n主な単語: ${
            (analysisData.value.words || []).map(w => w.word).join(', ')
          }`;
        }

        const payload = {
          action: 'check_essay',
          userEssay: userEssay.value,
          imageContext: imageContext
        };

        const response = await fetch(gasUrl.value, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow'
        });

        const res = await response.json();
        if (res.status === 'success' && res.data) {
          correctionData.value = res.data;
          showToast('Geminiによる作文の添削が完了しました！', 'success');
        } else {
          showToast(res.message || '添削に失敗しました', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('通信エラーが発生しました: ' + err.message, 'error');
      } finally {
        isCheckingEssay.value = false;
      }
    };

    // 単語を作文入力欄に挿入
    const insertWordToEssay = (word) => {
      if (!word) return;
      if (!userEssay.value) {
        userEssay.value = word;
      } else {
        userEssay.value += (userEssay.value.endsWith(' ') || userEssay.value.endsWith('，') || userEssay.value.endsWith('。') ? '' : ' ') + word;
      }
      showToast(`「${word}」を作文に挿入しました`, 'info');
      nextTick(() => {
        if (essayTextarea.value) {
          essayTextarea.value.focus();
        }
      });
    };

    // 中国語音声読み上げ (Web Speech API)
    const speakChinese = (text) => {
      if (!window.speechSynthesis) {
        showToast('お使いのブラウザは音声合成に対応していません', 'warning');
        return;
      }
      window.speechSynthesis.cancel(); // 前の音声を停止
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN'; // 中国語 (普通話)
      utterance.rate = 0.85;    // 学習者向けにややゆっくり
      utterance.pitch = 1.0;

      // 中国語対応の音声を探す
      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang === 'zh-CN' || v.lang.startsWith('zh'));
      if (zhVoice) {
        utterance.voice = zhVoice;
      }

      window.speechSynthesis.speak(utterance);
    };

    // サンプルプリセットの読み込み
    const loadSamplePreset = (type) => {
      let sampleImgUrl = '';
      let fileName = '';

      if (type === 'cafe') {
        // カフェのイラストSVG
        sampleImgUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
            <rect width="600" height="400" fill="#fef3c7"/>
            <rect x="50" y="240" width="500" height="20" fill="#b45309" rx="5"/>
            <path d="M 220 180 L 230 240 L 370 240 L 380 180 Z" fill="#ffffff" stroke="#d97706" stroke-width="4"/>
            <path d="M 375 195 C 400 195 400 225 375 225" fill="none" stroke="#d97706" stroke-width="4"/>
            <ellipse cx="300" cy="180" rx="80" ry="20" fill="#78350f"/>
            <path d="M 280 160 Q 270 140 280 120" stroke="#f59e0b" stroke-width="3" fill="none" stroke-linecap="round"/>
            <path d="M 300 160 Q 310 140 300 120" stroke="#f59e0b" stroke-width="3" fill="none" stroke-linecap="round"/>
            <path d="M 320 160 Q 310 140 320 120" stroke="#f59e0b" stroke-width="3" fill="none" stroke-linecap="round"/>
            <rect x="120" y="160" width="70" height="80" fill="#0284c7" rx="6"/>
            <rect x="130" y="170" width="50" height="4" fill="#ffffff" rx="2"/>
            <rect x="130" y="180" width="40" height="4" fill="#ffffff" rx="2"/>
            <rect x="130" y="190" width="45" height="4" fill="#ffffff" rx="2"/>
            <text x="300" y="80" font-size="24" font-weight="bold" fill="#78350f" text-anchor="middle" font-family="sans-serif">☕ 咖啡厅 (Café)</text>
            <text x="300" y="320" font-size="16" fill="#92400e" text-anchor="middle" font-family="sans-serif">画像をクリックして解析できます</text>
          </svg>
        `);
        fileName = 'cafe_illustration.svg';
      } else if (type === 'park') {
        sampleImgUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
            <rect width="600" height="400" fill="#ecfdf5"/>
            <circle cx="480" cy="100" r="45" fill="#fbbf24"/>
            <path d="M 0 320 Q 300 260 600 320 L 600 400 L 0 400 Z" fill="#10b981"/>
            <rect x="120" y="220" width="25" height="90" fill="#78350f"/>
            <circle cx="132" cy="180" r="60" fill="#059669"/>
            <circle cx="150" cy="150" r="45" fill="#34d399"/>
            <circle cx="110" cy="150" r="45" fill="#10b981"/>
            <rect x="360" y="270" width="120" height="15" fill="#b45309" rx="4"/>
            <rect x="375" y="285" width="8" height="25" fill="#78350f"/>
            <rect x="455" y="285" width="8" height="25" fill="#78350f"/>
            <text x="300" y="70" font-size="24" font-weight="bold" fill="#065f46" text-anchor="middle" font-family="sans-serif">🌳 公园 (Park)</text>
          </svg>
        `);
        fileName = 'park_illustration.svg';
      }

      currentImage.value = {
        base64: sampleImgUrl,
        mimeType: 'image/svg+xml',
        name: fileName,
        previewUrl: sampleImgUrl
      };

      // デモ解析データを自動ロード
      analysisData.value = getDemoAnalysis(type);
      driveInfo.value = {
        saved: true,
        fileName: fileName,
        folderName: '中国語写真作文_Images (Sample)'
      };
      isFromCache.value = true;
      userEssay.value = type === 'cafe' ? '我在咖啡厅喝咖啡。咖啡很好喝，我很喜欢看书。' : '今天天气很好。公园里有很大的树，很多人散步。';
    };

    // デモデータ生成
    const getDemoAnalysis = (type = 'cafe') => {
      if (type === 'cafe') {
        return {
          scene_description_ja: "静かなカフェのテーブルに置かれた温かいコーヒーと本",
          words: [
            {
              word: "咖啡",
              pinyin: "kāfēi",
              pos: "名詞",
              meaning: "コーヒー",
              example_cn: "我每天早上喝一杯热咖啡。",
              example_pinyin: "Wǒ měitiān zǎoshang hē yì bēi rè kāfēi.",
              example_ja: "私は毎朝温かいコーヒーを一杯飲みます。"
            },
            {
              word: "咖啡厅",
              pinyin: "kāfēitīng",
              pos: "名詞",
              meaning: "カフェ、喫茶店",
              example_cn: "这家咖啡厅的环境很安静。",
              example_pinyin: "Zhè jiā kāfēitīng de huánjìng hěn ānjìng.",
              example_ja: "このカフェの雰囲気はとても静かです。"
            },
            {
              word: "书",
              pinyin: "shū",
              pos: "名詞",
              meaning: "本",
              example_cn: "桌子上放着一本中文书。",
              example_pinyin: "Zhuōzi shang fàngzhe yì běn Zhōngwén shū.",
              example_ja: "机の上に中国語の本が一冊置かれています。"
            },
            {
              word: "杯子",
              pinyin: "bēizi",
              pos: "名詞",
              meaning: "コップ、カップ",
              example_cn: "这个白色的杯子很漂亮。",
              example_pinyin: "Zhè ge báisè de bēizi hěn piàoliang.",
              example_ja: "この白いカップはとても綺麗です。"
            },
            {
              word: "安静",
              pinyin: "ānjìng",
              pos: "形容詞",
              meaning: "静かである",
              example_cn: "图书馆里非常安静。",
              example_pinyin: "Túshūguǎn li fēicháng ānjìng.",
              example_ja: "図書館の中はとても静かです。"
            },
            {
              word: "看书",
              pinyin: "kàn shū",
              pos: "動詞フレーズ",
              meaning: "読書する、本を読む",
              example_cn: "我喜欢边喝茶边看书。",
              example_pinyin: "Wǒ xǐhuan biān hē chá biān kàn shū.",
              example_ja: "私はお茶を飲みながら本を読むのが好きです。"
            },
            {
              word: "桌子",
              pinyin: "zhuōzi",
              pos: "名詞",
              meaning: "机、テーブル",
              example_cn: "木头桌子上干干净净的。",
              example_pinyin: "Mùtou zhuōzi shang gāngānjìngjìng de.",
              example_ja: "木製の机の上はとても清潔です。"
            },
            {
              word: "享受",
              pinyin: "xiǎngshòu",
              pos: "動詞",
              meaning: "楽しむ、享受する",
              example_cn: "我很享受周末的悠闲时光。",
              example_pinyin: "Wǒ hěn xiǎngshòu zhōumò de yōuxián shíguāng.",
              example_ja: "私は週末ののんびりした時間を楽しんでいます。"
            }
          ],
          model_essays: {
            beginner: {
              level_title: "初級（HSK 1-2 レベル）",
              essay_cn: "桌子上有一杯热咖啡和一本书。我在安静的咖啡厅里看书。咖啡很好喝，我很开心。",
              essay_pinyin: "Zhuōzi shang yǒu yì bēi rè kāfēi hé yì běn shū. Wǒ zài ānjìng de kāfēitīng li kàn shū. Kāfēi hěn hǎohē, wǒ hěn kāixīn.",
              essay_ja: "机の上に温かいコーヒーが一杯と本が一冊あります。私は静かなカフェで本を読んでいます。コーヒーは美味しくて、とても楽しいです。",
              key_points: [
                "「在〜里 (〜の中で)」の場所表現",
                "「有一杯〜 (〜が一杯ある)」の量詞の使い方"
              ]
            },
            intermediate: {
              level_title: "中級（HSK 3-4 レベル）",
              essay_cn: "在这个阳光明媚的下午，我来到了常去的咖啡厅。木桌上冒着热气的咖啡散发着浓郁的香味，旁边放着一本读到一半的小说。一边品尝咖啡一边静下心来读书，这种悠闲的时光让人感到格外轻松惬意。",
              essay_pinyin: "Zài zhè ge yángguāng míngmèi de xiàwǔ, wǒ láidào le cháng qù de kāfēitīng. Mùzhuō shang màozhe rèqì de kāfēi sànfāzhe nóngyù de xiāngwèi, pángbiān fàngzhe yì běn dú dào yíbàn de xiǎoshuō. Yìbiān pǐncháng kāfēi yìbiān jìng xia xīn lai dú shū, zhè zhǒng yōuxián de shíguāng ràng rén gǎndào géwài qīngsōng qièyì.",
              essay_ja: "陽の光が心地よい午後に、私はいつものカフェにやってきました。木製テーブルの湯気立つコーヒーからは芳醇な香りが漂い、傍らには読みかけの小説が置かれています。コーヒーを味わいながら心を落ち着かせて読書する、このようなゆったりした時間は格別にリラックスして心地よいものです。",
              key_points: [
                "「一边〜一边… (〜しながら…する)」の並行動作構文",
                "「着 (〜している)」を用いた状態描写 (冒着热气、放着)",
                "「让 (使役: 〜させる)」の構文"
              ]
            }
          }
        };
      } else {
        return {
          scene_description_ja: "緑豊かな公園と青空、木陰のベンチ",
          words: [
            {
              word: "公园",
              pinyin: "gōngyuán",
              pos: "名詞",
              meaning: "公園",
              example_cn: "周末很多人去公园玩。",
              example_pinyin: "Zhōumò hěn duō rén qù gōngyuán wán.",
              example_ja: "週末は多くの人が公園に遊びに行きます。"
            },
            {
              word: "大树",
              pinyin: "dàshù",
              pos: "名詞",
              meaning: "大きな木",
              example_cn: "大树下很凉快。",
              example_pinyin: "Dàshù xià hěn liángkuai.",
              example_ja: "大きな木の下はとても涼しいです。"
            },
            {
              word: "散步",
              pinyin: "sànbù",
              pos: "動詞 (離合詞)",
              meaning: "散歩する",
              example_cn: "吃完晚饭后我们去散散步吧。",
              example_pinyin: "Chī wán wǎnfàn hòu wǒmen qù sànsan bù ba.",
              example_ja: "晩ご飯を食べた後、少し散歩に行きましょう。"
            },
            {
              word: "长椅",
              pinyin: "chángyǐ",
              pos: "名詞",
              meaning: "ベンチ、長椅子",
              example_cn: "他在公园的长椅上休息。",
              example_pinyin: "Tā zài gōngyuán de chángyǐ shang xiūxi.",
              example_ja: "彼は公園のベンチで休憩しています。"
            }
          ],
          model_essays: {
            beginner: {
              level_title: "初級（HSK 1-2 レベル）",
              essay_cn: "今天天气非常好。公园里有绿色的大树和舒服的长椅。许多人在公园里散步。",
              essay_pinyin: "Jīntiān tiānqì fēicháng hǎo. Gōngyuán li yǒu lǜsè de dàshù hé shūfu de chángyǐ. Xǔduō rén zài gōngyuán li sànbù.",
              essay_ja: "今日の天気はとても良いです。公園には緑の大木と快適なベンチがあります。多くの人が公園で散歩しています。",
              key_points: ["天気の表現", "場所 + 有 + 目的語 の存在文"]
            },
            intermediate: {
              level_title: "中級（HSK 3-4 レベル）",
              essay_cn: "阳光洒在郁郁葱葱的公园里。微风吹过树梢，让人心旷神怡。坐在长椅上静静地看着散步的人们，感受大自然的美好。",
              essay_pinyin: "Yángguāng sǎ zài yùyùcōngcōng de gōngyuán li. Wēifēng chuī guò shùshāo, ràng rén xīnkuàng-shényí. Zuò zài chángyǐ shang jìngjìng de kànzhe sànbù de rénmen, gǎnshòu dàzìrán de měihǎo.",
              essay_ja: "青々とした公園に陽の光が降り注いでいます。そよ風が木々の梢を吹き抜け、心を晴れやかにしてくれます。ベンチに座って散歩する人々を静かに眺めながら、大自然の素晴らしさを感じています。",
              key_points: ["成語「心旷神怡 (気分爽快である)」", "情景描写の動詞「洒 (注ぐ)」"]
            }
          }
        };
      }
    };

    // デモ添削データ生成
    const getDemoCorrection = (input) => {
      return {
        score: 92,
        score_comment: "素晴らしい作文です！情景が明確で、基本的な語順もしっかり身についています。より自然な中国語表現に微調整しました。",
        corrected_essay: "我正在咖啡厅里喝咖啡。这里的咖啡非常好喝，我也很喜欢在这里看书。",
        corrected_pinyin: "Wǒ zhèngzài kāfēitīng li hē kāfēi. Zhèli de kāfēi fēicháng hǎohē, wǒ yě hěn xǐhuan zài zhèli kàn shū.",
        corrected_ja: "私はちょうどカフェでコーヒーを飲んでいるところです。ここのコーヒーはとても美味しく、私はここで読書をするのも大好きです。",
        corrections: [
          {
            original: "在咖啡厅",
            corrected: "在咖啡厅里 / 正在咖啡厅里",
            pinyin: "zài kāfēitīng li / zhèngzài kāfēitīng li",
            reason: "「〜の中で」を表すときは「在 + 場所 + 里」とするのが自然です。また「正在」を加えると動作の臨場感が出ます。"
          },
          {
            original: "我很喜欢看书",
            corrected: "我也很喜欢在这里看书",
            pinyin: "wǒ yě hěn xǐhuan zài zhèli kàn shū",
            reason: "「ここで本を読むのが好き」と場所の副詞句「在这里」を動詞の前に補うと、前の文との繋がりがより自然になります。"
          }
        ],
        better_expressions: [
          {
            expression: "一边喝咖啡，一边看书",
            pinyin: "yìbiān hē kāfēi, yìbiān kàn shū",
            meaning: "コーヒーを飲みながら本を読む（2つの動作の同時進行構文）"
          },
          {
            expression: "享受悠闲的时光",
            pinyin: "xiǎngshòu yōuxián de shíguāng",
            meaning: "のんびりとした時間を楽しむ（カフェ描写にぴったりの表現）"
          }
        ],
        grammar_tips: [
          "中国語の語順ルール: 「主語 + [時間/場所/方法] + 動詞 + 目的語」（日本語と違い、場所は動詞の前に置きます）",
          "形容詞述語文: 「很」は単なる「とても」の意味だけでなく、形容詞述語文で語調を整えるために自然に添えられます。"
        ]
      };
    };

    return {
      // 設定 & テーマ
      gasUrl,
      tempGasUrl,
      configGasUrl,
      spreadsheetUrl,
      driveFolderUrl,
      applyConfigGasUrl,
      clearCustomGasUrl,
      isDarkTheme,
      isDemoMode,
      showSettingsModal,
      isTestingConnection,
      toggleTheme,
      openSettings,
      closeSettings,
      saveSettings,
      testGasConnection,

      // 画像 & 解析
      currentImage,
      isAnalyzing,
      analysisData,
      driveInfo,
      isFromCache,
      handleFileChange,
      handleDrop,
      analyzeImage,
      loadSamplePreset,

      // Google Drive ギャラリー
      showDriveModal,
      driveFiles,
      isLoadingDriveFiles,
      isLoadingDriveImage,
      openDriveModal,
      closeDriveModal,
      fetchDriveFiles,
      selectDriveFile,

      // 作文 & 添削
      userEssay,
      isCheckingEssay,
      correctionData,
      checkEssay,
      insertWordToEssay,
      essayTextarea,

      // UI
      activeTab,
      modelLevel,
      speakChinese,
      toasts
    };
  }
}).mount('#app');
