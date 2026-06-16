// 边缘吸附的「预览框」共享信号。
// 拖窗时 Window 往这里写目标几何（layer 坐标系），Desktop 据此画一个半透明预览框；
// 松手后清空。是一份纯 UI 的瞬时状态，所以放 shell 而不是 kernel。
export interface SnapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 用一个对象包着 preview，方便跨组件共享并就地改字段
export const snapState = $state<{ preview: SnapRect | null }>({ preview: null });
