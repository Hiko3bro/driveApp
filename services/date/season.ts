export type SeasonHint = '春' | '夏' | '秋' | '冬';

/**
 * 月から機械的に季節を算出する(気象庁の区分に準拠、3-5月=春/6-8月=夏/9-11月=秋/12-2月=冬)。
 * 外部の天気・カレンダーAPIは使わない。AIへは「弱い参考情報」として渡す前提で、
 * 開花・積雪等の実況を断定させる用途には使わないこと。
 */
export function resolveSeasonHint(date: Date): SeasonHint {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) {
    return '春';
  }
  if (month >= 6 && month <= 8) {
    return '夏';
  }
  if (month >= 9 && month <= 11) {
    return '秋';
  }
  return '冬';
}
