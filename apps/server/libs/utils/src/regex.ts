export const regexMap = {
  uuidv4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  emailOffSensitive: /([\w.%+-]{1,2})(@\w+\.)(com|net|org)/,
  phoneNumberSensitive: /^(\d{3})\d{4}(\d{4})$/,
}
