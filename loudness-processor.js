// loudness-processor.js (新規ファイル)
// このファイルは拡張機能のルートディレクトリに配置します

class LoudnessProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // 状態の初期化
    this.rmsValues = [];
    this.bufferSize = 1024;  // 分析バッファサイズ
    this.historySize = 10;   // 平滑化のための履歴サイズ
    
    // ポートメッセージハンドラを設定
    this.port.onmessage = (event) => {
      if (event.data.type === 'config') {
        // 設定更新のメッセージを受信
        this.targetLoudness = event.data.targetLoudness;
        this.loudnessRange = event.data.loudnessRange;
      }
    };
    
    // デフォルト設定
    this.targetLoudness = -14;  // デフォルトのターゲットLUFS
    this.loudnessRange = 7;     // デフォルトの許容範囲
    
    // 状態フラグ
    this.isActive = true;
  }
  
  // オーディオ処理関数 - 各オーディオフレームごとに呼び出される
  process(inputs, outputs, parameters) {
    if (!this.isActive || !inputs[0] || !inputs[0][0]) {
      // 入力または接続がない場合は処理をスキップ
      return true;
    }
    
    // 入力データ（通常は左チャンネル）を取得
    const input = inputs[0][0];
    
    // RMSレベルを計算
    let sumOfSquares = 0;
    for (let i = 0; i < input.length; i++) {
      sumOfSquares += input[i] * input[i];
    }
    const rms = Math.sqrt(sumOfSquares / input.length);
    
    // RMSをdBに変換
    let dbFS = 20 * Math.log10(rms > 0 ? rms : 0.00001);
    
    // LUFSへの簡易変換 (実際のLUFSはより複雑)
    // EBU R128の簡易近似として、10dBの補正を適用
    let lufs = dbFS - 10;
    
    // 小さすぎる値（実質無音）を除外
    if (lufs > -70) {
      // 平滑化のために履歴に追加
      this.rmsValues.push(lufs);
      if (this.rmsValues.length > this.historySize) {
        this.rmsValues.shift();
      }
      
      // 平均ラウドネスを計算
      const avgLoudness = this.rmsValues.reduce((sum, value) => sum + value, 0) / this.rmsValues.length;
      
      // メインスレッドに現在の測定値を送信
      this.port.postMessage({
        type: 'measurement',
        loudness: avgLoudness
      });
    }
    
    // ノードを接続し続けるためにtrueを返す
    return true;
  }
}

// AudioWorkletProcessorを登録
registerProcessor('loudness-processor', LoudnessProcessor);
