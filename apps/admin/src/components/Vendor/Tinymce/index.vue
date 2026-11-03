<script lang="ts" setup>
import type { RawEditorOptions } from 'tinymce'
import type { ICompVendorTinymceProps } from '.'
import TinymceEditor from '@tinymce/tinymce-vue'
import { genString } from 'easy-fns-ts'
import { computed, ref, shallowRef, watch } from 'vue'

import { isDark } from '@/hooks/app/useAppDark'
import { useAppStoreLocale } from '@/store/modules/app/app-locale'
import { menubar, plugins, toolbar } from './resource'

defineOptions({
  name: 'WCompVendorTinymce',
  inheritAttrs: false,
})

const props = withDefaults(defineProps<ICompVendorTinymceProps>(), {
  disabled: false,
  width: '100%',
})

const value = defineModel<string>('value')

interface TinymceVueInstance {
  rerender: (p: RawEditorOptions) => Promise<void>
}

const editorId = ref(`tinymce-${genString(8)}`)
// third party libs should use shallowRef !!!
const editorRef = shallowRef<TinymceVueInstance>()

const loading = ref(false)

const appStoreLocale = useAppStoreLocale()

const getSkinName = computed(() =>
  isDark.value ? 'tinymce-5-dark' : 'tinymce-5',
)

const getLangName = computed(() => appStoreLocale.locale!)

const tinymceOptions = computed((): RawEditorOptions => {
  return {
    license_key: 'gpl',
    promotion: false,
    selector: `#${editorId.value}`,

    // remove right bottom logo
    branding: false,

    height: props.height,
    width: props.width,

    // theme
    skin: getSkinName.value,
    content_css: getSkinName.value,

    // locale
    directionality: 'ltr',
    language: getLangName.value === 'en_US' ? undefined : getLangName.value,
    language_load: true,

    // settings
    plugins,
    menubar,
    toolbar,

    init_instance_callback() {
      loading.value = false
    },
  }
})

watch(
  () => [getSkinName, getLangName],
  async () => {
    loading.value = true

    await editorRef.value?.rerender(tinymceOptions.value)
  },
  {
    deep: true,
    immediate: true,
  },
)

// 自托管 tinymce 的**唯一来源**是前端自己的 public/vendor（2026-11 批次 4 · D20 从
// apps/server/apps/api/src/public/js 搬来：那 4.08MB / 125 个文件原本随后端镜像分发，
// 后端并不消费它）。与 public/vendor 的其它项（codeMirror 等）同约定：站点根相对路径，
// 不走 VITE_PUBLIC_PATH（各环境都是 '/'，见 apps/admin/env-*.env）。
const tinymceScriptSrc = '/vendor/tinymce/tinymce.min.js'
</script>

<template>
  <n-spin :show="loading" class="w-full">
    <TinymceEditor
      :id="editorId"
      ref="editorRef"
      v-model="value"
      :tinymce-script-src="tinymceScriptSrc"
      api-key="no-api-key"
      license-key="gpl"
      :init="tinymceOptions"
      model-events="change input keydown blur focus paste"
      :disabled="disabled"
    />
  </n-spin>
</template>
