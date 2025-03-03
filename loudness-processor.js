// loudness-processor.js - 改善版
// AudioWorkletProcessor を使ったラウドネス測定の実装

class LoudnessProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // 状態の初期化
    this.rmsValues = [];
    this.bufferSize = 1024;  
    this.historySize = 10;   
    
    // ポートメッセージハンドラを設定
    this.port.onmessage = (event) => {
      if (event.data.type === 'config') {
        // 設定更新のメッセージを受信
        this.targetLoudness = event.data.targetLoudness || this.targetLoudness;
        this.loudnessRange = event.data.loudnessRange || this.loudnessRange;
      } else if (event.data.type === 'reset') {
        // 状態リセット
        this.rmsValues = [];
      }
    };
    
    // デフォルト設定
    this.targetLoudness = -20;  // デフォルトのターゲットLUFS
    this.loudnessRange = 7;     // デフォルトの許容範囲
    
    // 状態フラグ
    this.isActive = true;
    
    // 測定間隔の制御（毎フレームではなく一定間隔で処理）
    this.frameCounter = 0;
    this.measurementInterval = 5; // 5フレームごとに測定
    
    // エラー処理をロギング
    try {
      console.log('[LoudnessProcessor] Initialized');
    } catch (e) {
      // workletコンテキストではconsole.logが使えない場合がある
    }
  }
  
  // オーディオ処理関数 - 各オーディオフレームごとに呼び出される
  process(inputs, outputs, parameters) {
    // 入力チェック
    if (!this.isActive || !inputs || !inputs[0] || !inputs[0][0] || inputs[0][0].length === 0) {
      // 入力がないか無効な場合は、そのまま出力を返す（バイパス）
      if (outputs && outputs[0] && outputs[0].length > 0) {
        for (let channelIdx = 0; channelIdx < outputs[0].length; channelIdx++) {
          if (inputs[0] && inputs[0][channelIdx]) {
            // 入力があれば出力にコピー
            outputs[0][channelIdx].set(inputs[0][channelIdx]);
          }
        }
      }
      
      // 処理を継続
      return true;
    }
    
    // 測定間隔を制御（頻度を下げる）
    this.frameCounter++;
    if (this.frameCounter % this.measurementInterval !== 0) {
      // 測定間隔ではない場合はオーディオをそのまま通過
      for (let channelIdx = 0; channelIdx < outputs[0].length; channelIdx++) {
        if (inputs[0][channelIdx]) {
          outputs[0][channelIdx].set(inputs[0][channelIdx]);
        }
      }
      return true;
    }
    
    // 入力データ（通常は左チャンネル）を取得
    const input = inputs[0][0];
    
    try {
      // RMSレベルを計算
      let sumOfSquares = 0;
      for (let i = 0; i < input.length; i++) {
        sumOfSquares += input[i] * input[i];
      }
      
      // ゼロ除算防止とRMS計算
      const rms = Math.sqrt(sumOfSquares / (input.length || 1));
      
      // RMSをdBに変換 (無音時の例外処理)
      let dbFS = 20 * Math.log10(Math.max(rms, 0.00001));
      
      // LUFSへの簡易変換 (実際のLUFSはより複雑)
      // EBU R128の簡易近似として、10dBの補正を適用
      const lufs = Math.min(0, Math.max(-70, dbFS - 10));
      
      // 小さすぎる値（実質無音）を除外
      if (lufs > -60) {
        // 平滑化のために履歴に追加
        this.rmsValues.push(lufs);
        if (this.rmsValues.length > this.historySize) {
          this.rmsValues.shift();
        }
        
        // 平均ラウドネスを計算
        const sum = this.rmsValues.reduce((sum, value) => sum + value, 0);
        const avgLoudness = sum / (this.rmsValues.length || 1);
        
        // メインスレッドに現在の測定値を送信
        this.port.postMessage({
          type: 'measurement',
          loudness: avgLoudness
        });
      }
    } catch (error) {
      // エラーが発生しても処理を中断しない
      this.port.postMessage({
        type: 'error',
        message: error.message || 'Unknown error in LoudnessProcessor'
      });
    }
    
    // 入力をそのまま出力にコピー（パススルー）
    // これはオーディオを変更せず、分析のみを行う場合の標準的なパターン
    for (let channelIdx = 0; channelIdx < outputs[0].length; channelIdx++) {
      if (inputs[0][channelIdx]) {
        outputs[0][channelIdx].set(inputs[0][channelIdx]);
      }
    }
    
    // ノードを接続し続けるためにtrueを返す
    return true;
  }
}

// AudioWorkletProcessorを登録
registerProcessor('loudness-processor', LoudnessProcessor);