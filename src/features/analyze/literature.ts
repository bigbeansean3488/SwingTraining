// General observations from published biomechanics research, shown next to a
// metric as background reading. Not personalised advice: they never say what
// THIS athlete should change. See docs/DECISIONS.md D19.
// Only statements checked against the paper's abstract or a primary summary
// are listed; metrics without a checked source simply have no note.
import type { MotionKind } from '../../analysis/types';

export interface Reference {
  id: string;
  /** Short in-text form, e.g. 'Welch 等（1995）'. */
  short: string;
  citation: string;
  url: string;
}

export const REFERENCES: Record<string, Reference> = {
  welch1995: {
    id: 'welch1995',
    short: 'Welch 等（1995）',
    citation:
      'Welch, C. M., Banks, S. A., Cook, F. F., & Draovitch, P. (1995). Hitting a baseball: A biomechanical description. Journal of Orthopaedic & Sports Physical Therapy, 22(5), 193–201.',
    url: 'https://doi.org/10.2519/jospt.1995.22.5.193',
  },
  kishita2020elite: {
    id: 'kishita2020elite',
    short: 'Kishita 等（2020a）',
    citation:
      'Kishita, Y., Ueda, H., & Kashino, M. (2020). Eye and head movements of elite baseball players in real batting. Frontiers in Sports and Active Living, 2, 3.',
    url: 'https://doi.org/10.3389/fspor.2020.00003',
  },
  kishita2020speed: {
    id: 'kishita2020speed',
    short: 'Kishita 等（2020b）',
    citation:
      'Kishita, Y., Ueda, H., & Kashino, M. (2020). Temporally coupled coordination of eye and body movements in baseball batting for a wide range of ball speeds. Frontiers in Sports and Active Living, 2, 64.',
    url: 'https://doi.org/10.3389/fspor.2020.00064',
  },
  matsuo2001: {
    id: 'matsuo2001',
    short: 'Matsuo 等（2001）',
    citation:
      'Matsuo, T., Escamilla, R. F., Fleisig, G. S., Barrentine, S. W., & Andrews, J. R. (2001). Comparison of kinematic and temporal parameters between different pitch velocity groups. Journal of Applied Biomechanics, 17(1), 1–13.',
    url: 'https://doi.org/10.1123/jab.17.1.1',
  },
  fleisig2010: {
    id: 'fleisig2010',
    short: 'Fleisig（2010）',
    citation:
      'Fleisig, G. S. (2010). Biomechanics of baseball pitching: Implications for injury and performance. Proceedings of the XXVIII International Symposium of Biomechanics in Sports, Marquette, MI.',
    url: 'https://ojs.ub.uni-konstanz.de/cpa/article/view/4377',
  },
};

export interface LiteratureNote {
  text: string;
  refs: string[];
}

/** Applies to every note. */
export const LITERATURE_CAVEAT =
  '以下是公開研究的一般觀察，不是針對你的建議。研究對象多是成人或職業選手、用實驗室的 3D 設備量測，跟這支手機量到的數字不能直接比較。要不要調整動作，請跟教練討論。';

export const LITERATURE: Record<MotionKind, Record<string, LiteratureNote[]>> = {
  batting: {
    phase_load_ms: [
      {
        text: '研究描述打擊動作是從「重心移到後腳、軀幹扭轉」開始的。',
        refs: ['welch1995'],
      },
    ],
    pelvis_shift: [
      {
        text: '研究描述打擊動作是從「重心移到後腳、軀幹扭轉」開始，之後重心才往投手方向移動。',
        refs: ['welch1995'],
      },
    ],
    seq_pelvis_lead_ms: [
      {
        text: '研究量到髖部的轉動速度先達到最高，肩膀的轉動速度之後才達到最高。',
        refs: ['welch1995'],
      },
    ],
    head_dx: [
      {
        text: '研究發現職業打者追球時，主要是靠轉頭，而不是轉眼睛。注意：這裡量的是頭的位置移動，不是轉頭的角度。',
        refs: ['kishita2020elite'],
      },
      {
        text: '另一項研究發現，不論球速快慢，打者眼睛和頭部的快速移動都跟擊球、髖部轉動的時間同步，代表看球的方式會受揮棒動作影響。',
        refs: ['kishita2020speed'],
      },
    ],
    head_dy: [
      {
        text: '研究發現職業打者追球時，主要是靠轉頭，而不是轉眼睛。注意：這裡量的是頭的位置移動，不是轉頭的角度。',
        refs: ['kishita2020elite'],
      },
    ],
  },
  pitching: {
    stride_length: [
      {
        text: '研究常用「身高的百分比」描述跨步。有文獻整理的參考範圍是：前腳著地時跨步約為身高的 83%（±4%）。這裡用軀幹長表示，兩者無法直接換算。',
        refs: ['fleisig2010'],
      },
    ],
    lead_knee_release: [
      {
        text: '一項比較大學與職業投手的研究中，球速較快的一組在出手時前膝伸直的速度較大，而且多數人在接近出手時前膝是在伸直。這是兩組之間的差異，不代表伸直就會變快；這個 App 也不量球速。',
        refs: ['matsuo2001'],
      },
    ],
    trunk_forward_release: [
      {
        text: '同一項研究中，球速較快的一組在出手瞬間上半身前傾的角度較大。這是兩組之間的差異，不代表前傾就會變快。',
        refs: ['matsuo2001'],
      },
    ],
  },
};

export function literatureFor(kind: MotionKind, key: string): LiteratureNote[] {
  return LITERATURE[kind][key] ?? [];
}
