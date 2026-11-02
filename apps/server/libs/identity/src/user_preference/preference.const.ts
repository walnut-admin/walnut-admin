/**
 * User Preference Module Constants
 * （自 schema/user_preference.schema.ts 搬出：schema 只留 DTO 元数据类，业务常量归 const 文件；
 *   wire 值集已上收 @walnut/contract，前端偏好 store 同源消费）
 */

export {
  colorModeConst,
  CVDConst,
  fontSizeConst,
  fontSizeValues,
  type IColorModeConst,
  type ICVDConst,
  type IFontSizeConst,
  type ILayoutModeConst,
  layoutModeConst,
} from '@walnut/contract/preference'
