export const regexMap = {
  uuidv4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  // local 段保留前 1-2 位后打星、@domain 原样；域名不限定 TLD（旧的 (com|net|org) 会让
  // `user@example.cn` 完全不掩码，多级域名也只能从中间位置碰巧匹配）
  emailOffSensitive: /^([\w.%+-]{1,2})([\w.%+-]*)(@[\w.-]+)/,
  phoneNumberSensitive: /^(\d{3})\d{4}(\d{4})$/,
}
