import type {
  Examples,
} from 'libphonenumber-js'
import { ref } from 'vue'

export const phoneNumberExample = ref<Examples>()

export async function getExamplePhoneNumber() {
  if (!phoneNumberExample.value) {
    const { default: data } = await import('libphonenumber-js/examples.mobile.json')
    phoneNumberExample.value = data
  }
}
