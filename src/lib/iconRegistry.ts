// ───────────────────────────────────────────────────────────
// 图标注册表 · IconName → Lucide 组件（本文件是唯一 import Lucide 的地方）
// 类型 Record<IconName, …> 保证注册表与 icons.ts 的 ICON_NAMES 完整一致：
// 漏注册/多注册都会在 svelte-check / tsc 阶段直接报错。
// 逐图标按路径 import（非整包）→ tree-shaking 只打包用到的 77 个。
// ───────────────────────────────────────────────────────────
import type { Component } from 'svelte';
import Activity from '@lucide/svelte/icons/activity';
import AppWindow from '@lucide/svelte/icons/app-window';
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import Bell from '@lucide/svelte/icons/bell';
import BellOff from '@lucide/svelte/icons/bell-off';
import Bot from '@lucide/svelte/icons/bot';
import Brain from '@lucide/svelte/icons/brain';
import Calculator from '@lucide/svelte/icons/calculator';
import Camera from '@lucide/svelte/icons/camera';
import Check from '@lucide/svelte/icons/check';
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import ChevronUp from '@lucide/svelte/icons/chevron-up';
import Clapperboard from '@lucide/svelte/icons/clapperboard';
import Clipboard from '@lucide/svelte/icons/clipboard';
import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
import Clock from '@lucide/svelte/icons/clock';
import Delete from '@lucide/svelte/icons/delete';
import DoorOpen from '@lucide/svelte/icons/door-open';
import Download from '@lucide/svelte/icons/download';
import ExternalLink from '@lucide/svelte/icons/external-link';
import EyeOff from '@lucide/svelte/icons/eye-off';
import File from '@lucide/svelte/icons/file';
import FileArchive from '@lucide/svelte/icons/file-archive';
import FileText from '@lucide/svelte/icons/file-text';
import Folder from '@lucide/svelte/icons/folder';
import FolderOpen from '@lucide/svelte/icons/folder-open';
import Globe from '@lucide/svelte/icons/globe';
import History from '@lucide/svelte/icons/history';
import Hourglass from '@lucide/svelte/icons/hourglass';
import Image from '@lucide/svelte/icons/image';
import Info from '@lucide/svelte/icons/info';
import KeyRound from '@lucide/svelte/icons/key-round';
import Keyboard from '@lucide/svelte/icons/keyboard';
import Languages from '@lucide/svelte/icons/languages';
import Layers from '@lucide/svelte/icons/layers';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import List from '@lucide/svelte/icons/list';
import Lock from '@lucide/svelte/icons/lock';
import LockOpen from '@lucide/svelte/icons/lock-open';
import Maximize2 from '@lucide/svelte/icons/maximize-2';
import MessageSquare from '@lucide/svelte/icons/message-square';
import Minus from '@lucide/svelte/icons/minus';
import Moon from '@lucide/svelte/icons/moon';
import Music from '@lucide/svelte/icons/music';
import NotebookPen from '@lucide/svelte/icons/notebook-pen';
import Palette from '@lucide/svelte/icons/palette';
import Paperclip from '@lucide/svelte/icons/paperclip';
import Pencil from '@lucide/svelte/icons/pencil';
import Pin from '@lucide/svelte/icons/pin';
import Play from '@lucide/svelte/icons/play';
import Plus from '@lucide/svelte/icons/plus';
import Puzzle from '@lucide/svelte/icons/puzzle';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import Rocket from '@lucide/svelte/icons/rocket';
import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
import Ruler from '@lucide/svelte/icons/ruler';
import Save from '@lucide/svelte/icons/save';
import Scissors from '@lucide/svelte/icons/scissors';
import Search from '@lucide/svelte/icons/search';
import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
import Settings from '@lucide/svelte/icons/settings';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Square from '@lucide/svelte/icons/square';
import Sun from '@lucide/svelte/icons/sun';
import SunMoon from '@lucide/svelte/icons/sun-moon';
import Terminal from '@lucide/svelte/icons/terminal';
import Timer from '@lucide/svelte/icons/timer';
import Trash2 from '@lucide/svelte/icons/trash-2';
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import Undo2 from '@lucide/svelte/icons/undo-2';
import Upload from '@lucide/svelte/icons/upload';
import User from '@lucide/svelte/icons/user';
import Volume2 from '@lucide/svelte/icons/volume-2';
import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
import Wrench from '@lucide/svelte/icons/wrench';
import X from '@lucide/svelte/icons/x';
import ZoomIn from '@lucide/svelte/icons/zoom-in';
import ZoomOut from '@lucide/svelte/icons/zoom-out';
import type { IconName } from './icons';

const REGISTRY: Record<IconName, Component> = {
  Activity,
  AppWindow,
  ArrowRight,
  Bell,
  BellOff,
  Bot,
  Brain,
  Calculator,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  Clipboard,
  ClipboardPaste,
  Clock,
  Delete,
  DoorOpen,
  Download,
  ExternalLink,
  EyeOff,
  File,
  FileArchive,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  History,
  Hourglass,
  Image,
  Info,
  KeyRound,
  Keyboard,
  Languages,
  Layers,
  LayoutGrid,
  List,
  Lock,
  LockOpen,
  Maximize2,
  MessageSquare,
  Minus,
  Moon,
  Music,
  NotebookPen,
  Palette,
  Paperclip,
  Pencil,
  Pin,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Rocket,
  RotateCcw,
  Ruler,
  Save,
  Scissors,
  Search,
  SendHorizontal,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Square,
  Sun,
  SunMoon,
  Terminal,
  Timer,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  User,
  Volume2,
  WandSparkles,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
};

export function iconComponent(name: IconName): Component {
  return REGISTRY[name];
}
