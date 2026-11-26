/** 选择后置主摄（1×）用到的摄像头信息 */
export interface CameraInfo {
  deviceId: string;
  label: string;
  /** 浏览器报告的朝向（InputDeviceInfo.getCapabilities().facingMode），可能为空 */
  facing: string[];
}

const FRONT = /front|user|前置|前摄|自拍|facetime/i;
const BACK = /back|rear|environment|后置|后摄|背面/i;
/** 不是主摄的镜头：长焦、潜望、超广角、微距、景深、红外、黑白 */
const SECONDARY = /tele|periscope|wide|macro|depth|infrared|\bir\b|mono|长焦|潜望|广角|微距|景深|红外|黑白/i;

function isBack(camera: CameraInfo) {
  if (camera.facing.length) return camera.facing.includes('environment');
  return BACK.test(camera.label) && !FRONT.test(camera.label);
}

/** Android 的摄像头编号：Chrome「camera2 0, facing back」、Firefox「Camera 0, Facing back」 */
function lensIndex(label: string): number | null {
  const match = /\bcamera2?\s+(\d+)\b/i.exec(label);
  return match ? Number(match[1]) : null;
}

/**
 * 多摄手机只按 facingMode 打开时，浏览器可能选中长焦或超广角（例如 OPPO Find X8 Ultra 会拿到 10× 长焦）。
 * 返回应该使用的后置主摄 deviceId；无法判断或不需要更换时返回 null，保留浏览器的选择。
 *
 * - Android 按编号最小的后置摄像头（系统把每个朝向的主摄排在最前）；
 * - 没有编号时（如 iPhone），只有当前镜头明确是长焦/广角等副摄时才换成名字里没有这些字样的后置镜头；
 * - 名字都为空时，按浏览器列出的顺序取第一个后置摄像头。
 */
export function pickMainBackCamera(cameras: CameraInfo[], currentId?: string | null): string | null {
  const back = cameras.filter(isBack);
  if (back.length < 2) return null;
  const primary = back.filter((c) => !SECONDARY.test(c.label));
  if (!primary.length) return null;

  let best: CameraInfo | null = null;
  let bestIndex = Infinity;
  for (const camera of primary) {
    const index = lensIndex(camera.label);
    if (index !== null && index < bestIndex) {
      best = camera;
      bestIndex = index;
    }
  }
  if (best) return best.deviceId;

  if (back.every((c) => !c.label)) return back[0].deviceId;
  const current = back.find((c) => c.deviceId === currentId);
  if (current && SECONDARY.test(current.label)) return primary[0].deviceId;
  return null;
}
