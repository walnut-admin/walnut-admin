<script lang="tsx" setup>
import type { SystemMenu } from '@walnut/api-types'
import type { TreeNodeItem } from 'easy-fns-ts'
import type { DropdownOption } from 'naive-ui'
import { createReusableTemplate } from '@vueuse/core'
import { findPath } from 'easy-fns-ts'
import { isEmpty } from 'lodash-es'
import { darkTheme } from 'naive-ui'
import { computed } from 'vue'
import { getTheme } from '@/App/src/naive/src/theme'

// TODO 111
import WIcon from '@/components/UI/Icon'

import { isDark } from '@/hooks/app/useAppDark'
import { useAppI18n } from '@/locales/index'
import { useAppRouter, useAppRouterPush } from '@/router/index'
import { useAppStoreMenu } from '@/store/modules/app/app-menu'
import { useAppStoreSettingDev } from '@/store/modules/setting/setting-dev'

import { useAppStoreUserPreference } from '@/store/modules/user/user-preference'

const appStoreMenu = useAppStoreMenu()
const appStoreSettingDev = useAppStoreSettingDev()
const userStorePreference = useAppStoreUserPreference()

const { t } = useAppI18n()
const { currentRoute } = useAppRouter()

const [DefineBase, ReuseBase] = createReusableTemplate<{ item: TreeNodeItem<SystemMenu> }>()

const getChildren = computed((): TreeNodeItem<SystemMenu>[] | undefined => {
  const matched = findPath<SystemMenu>(
    appStoreMenu.menus,
    n =>
      n.name
      === (currentRoute.value.meta.menuActiveName
        ? currentRoute.value.meta.menuActiveName
        : currentRoute.value.name),
  )

  // handle menuActiveName
  if (currentRoute.value.meta.menuActiveName) {
    // 由当前路由合成的虚拟面包屑节点，不经服务端（无 type/component 等服务端字段）；
    // 生成 SystemMenu 业务字段全必填，这里按展示面整体断言
    matched?.push({
      id: '',
      name: currentRoute.value.name as string,
      path: currentRoute.value.path,
      meta: {
        ...currentRoute.value.meta,
      },
    } as SystemMenu)
  }

  return matched?.filter(item => item.title)
})

function getDropdownOptions(arr?: TreeNodeItem<SystemMenu>[]): DropdownOption[] | undefined {
  if (isEmpty(arr)) {
    return undefined
  }

  return arr?.map(
    i =>
      ({
        key: i.name,
        label: t(i.title as string),
        icon: userStorePreference.getBreadcrumbShowIcon
          ? () => <WIcon icon={currentRoute.value.name === i.name ? i.meta?.activeIcon ?? i.icon! : i.icon!} height="20"></WIcon>
          : null,
        children: getDropdownOptions(i.children),
      } as DropdownOption),
  )
}

async function onDropdownSelect(key: string) {
  await useAppRouterPush({ name: key })
}
</script>

<template>
  <DefineBase v-slot="{ item }">
    <div class="flex flex-row flex-nowrap items-center">
      <WIcon v-if="userStorePreference.getBreadcrumbShowIcon" :icon="item.meta?.activeIcon ?? item.icon!" height="20" class="mr-1" />

      {{ $t(item.title!) }}
    </div>
  </DefineBase>

  <WTransition appear :transition-name="appStoreSettingDev.getBreadcrumbTransition">
    <n-config-provider
      :theme="(!isDark && userStorePreference.getHeaderInverted)
        || isDark
        ? darkTheme
        : null"
    >
      <n-breadcrumb
        v-if="appStoreSettingDev.getBreadcrumbShow"
        :id="appStoreSettingDev.getBreadcrumbId" :separator="appStoreSettingDev.getBreadcrumbSeparator"
      >
        <n-breadcrumb-item v-for="item in getChildren" :key="item.id">
          <n-config-provider
            v-if="userStorePreference.getBreadcrumbShowDropdown"
            :theme="getTheme"
          >
            <n-dropdown show-arrow :options="getDropdownOptions(item.children)" @select="onDropdownSelect">
              <ReuseBase :item="item" />
            </n-dropdown>
          </n-config-provider>

          <WTransition v-else appear :transition-name="appStoreSettingDev.getBreadcrumbTransition" :duration="500">
            <ReuseBase :item="item" />
          </WTransition>
        </n-breadcrumb-item>
      </n-breadcrumb>
    </n-config-provider>
  </WTransition>
</template>
