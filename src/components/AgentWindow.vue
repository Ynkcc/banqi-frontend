<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * 可拖动浮动窗口：标题栏可拖拽移动，支持收起/展开，点击自动置顶。
 * 通过 #head 插槽自定义标题栏内容（标题、徽标、按钮等），
 * 通过默认插槽放置窗口主体内容。
 */
const props = withDefaults(
  defineProps<{
    /** 窗口序号，用于级联排布初始位置 */
    index: number;
    /** 窗口宽度（px） */
    width?: number;
  }>(),
  { width: 360 },
);

// 模块级共享的 z-index 计数器，保证每次点击都置顶
let zCounter = 2000;

const el = ref<HTMLElement | null>(null);
const pos = ref({ x: 0, y: 0 });
const z = ref(2000);
const dragging = ref(false);
const minimized = ref(false);

let startX = 0;
let startY = 0;
let baseX = 0;
let baseY = 0;

function bringFront() {
  zCounter += 1;
  z.value = zCounter;
}

function clamp(x: number, y: number): { x: number; y: number } {
  const margin = 8;
  const w = el.value?.offsetWidth ?? props.width;
  const maxX = window.innerWidth - w - margin;
  const maxY = window.innerHeight - 36 - margin; // 至少保留标题栏可见
  return {
    x: Math.min(Math.max(x, margin), Math.max(maxX, margin)),
    y: Math.min(Math.max(y, margin), Math.max(maxY, margin)),
  };
}

function onPointerDown(e: PointerEvent) {
  // 点击标题栏内的按钮（删除/收起）时不触发拖拽
  if ((e.target as HTMLElement).closest('button, input, select')) return;
  if (minimized.value && e.button !== 0) return;
  dragging.value = true;
  bringFront();
  startX = e.clientX;
  startY = e.clientY;
  baseX = pos.value.x;
  baseY = pos.value.y;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  pos.value = clamp(baseX + (e.clientX - startX), baseY + (e.clientY - startY));
}

function onPointerUp() {
  dragging.value = false;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}

onMounted(() => {
  // 级联初始位置
  const x = 24 + props.index * 36;
  const y = 80 + props.index * 32;
  pos.value = clamp(x, y);
  bringFront();
});

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
});
</script>

<template>
  <div
    ref="el"
    class="agent-window"
    :class="{ dragging, minimized }"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${width}px`, zIndex: z }"
  >
    <div class="agent-window-head" @pointerdown="onPointerDown">
      <span class="agent-window-grip" title="拖动窗口">⠿</span>
      <slot name="head" />
      <button class="agent-window-toggle" :title="minimized ? '展开' : '收起'" @click="minimized = !minimized">
        {{ minimized ? '▣' : '—' }}
      </button>
    </div>
    <div v-show="!minimized" class="agent-window-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.agent-window {
  position: fixed;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 32px);
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  background: #1c2230;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  color: inherit;
}
.agent-window.dragging {
  cursor: grabbing;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
}
.agent-window-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px 10px 0 0;
  background: rgba(255, 255, 255, 0.05);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.agent-window.minimized .agent-window-head {
  border-bottom: none;
}
.agent-window-grip {
  opacity: 0.6;
  font-size: 14px;
  letter-spacing: -2px;
}
.agent-window-toggle {
  margin-left: auto;
  padding: 0 6px;
  cursor: pointer;
}
.agent-window-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  overflow-y: auto;
}
</style>
