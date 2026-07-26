## [v1.18.0] - 2026-06-10

## Backend

### ✨ Features

- Otp module instead of standalone sms/phone module ([17be102](https://github.com/walnut-admin/walnut-admin-server/commit/17be10263d0ef1bc80ce636211895fae4b4b329f))

- User identity status update ([51e58cd](https://github.com/walnut-admin/walnut-admin-server/commit/51e58cd70ff5430fc24ddf87580098280849e977))

- Sensitive guard ([b0e7146](https://github.com/walnut-admin/walnut-admin-server/commit/b0e7146e1244791c23ba055f59c4ef2fb56ec60c))

- Monorepo first step ([08bbef1](https://github.com/walnut-admin/walnut-admin-server/commit/08bbef1416b4e16e12b84dc22ad6573aa6d7c8d5))

- Db lib ([203400c](https://github.com/walnut-admin/walnut-admin-server/commit/203400cc08d6e2e178c5988f4e4e94ab0e76b384))

- Mask module ([96063d5](https://github.com/walnut-admin/walnut-admin-server/commit/96063d5a2f468c5ee0d3bc1c55448dc6b064e39e))


### 🐛 Bug Fixes

- Risk user device inactive calc error ([8d07b66](https://github.com/walnut-admin/walnut-admin-server/commit/8d07b6610f0618accff2c66fce3f417c3af04b62))

- Err should throw in custom auth guard ([8733765](https://github.com/walnut-admin/walnut-admin-server/commit/87337650d8d7d56fe46d79b48ba1f17a5e308b97))

- Auth guard service inject error ([882f54d](https://github.com/walnut-admin/walnut-admin-server/commit/882f54d005a4ffb8da127f8475b3625424dc8ede))

- Auth log & opaque error collect ([43aac6c](https://github.com/walnut-admin/walnut-admin-server/commit/43aac6c420176845431bae0e7662bab945e4b627))

- Missing update identity verified status after token issued ([0480214](https://github.com/walnut-admin/walnut-admin-server/commit/0480214f44896b315f1e56b4f2415e118ffa7f9a))

- Static file ([46f93a2](https://github.com/walnut-admin/walnut-admin-server/commit/46f93a2d895114b46ad381dcdd66253cb48f475a))

- Cookie key error usage ([cc23304](https://github.com/walnut-admin/walnut-admin-server/commit/cc233045b655d07fbfab798aa581e838c9079586))

- User device list error ([6b9c84f](https://github.com/walnut-admin/walnut-admin-server/commit/6b9c84f79d56e9cd79a672349a8aa79b47004585))

- Ts/eslint error ([cc679ef](https://github.com/walnut-admin/walnut-admin-server/commit/cc679ef844fa84f72f69a3a44079d03f02bd3ac7))

- Request end logger error ([7981d97](https://github.com/walnut-admin/walnut-admin-server/commit/7981d973cac7ae5e07feaaace806a5e4b19693c3))

- Base repo update error ([4ad2670](https://github.com/walnut-admin/walnut-admin-server/commit/4ad267007004d4b8425bed72e4e78ec07c601da2))

- Object transform error ([e7fb9ac](https://github.com/walnut-admin/walnut-admin-server/commit/e7fb9ac1e9b262b505384a7fb8bd8acda4e1dcbb))

- Mask sensitive missing objectId ([8395a35](https://github.com/walnut-admin/walnut-admin-server/commit/8395a35c8384deedb58ba25d6fccf52ef1ba95e1))

- Missing include ([c570d9f](https://github.com/walnut-admin/walnut-admin-server/commit/c570d9feeab151f5327ad87d9cb9d0907a92c6cd))

- Build dist路径错误 ([2da7f82](https://github.com/walnut-admin/walnut-admin-server/commit/2da7f825946d7c82a4e52db762e5ed9fd26a066f))

- Area feedback cache error ([6dc1008](https://github.com/walnut-admin/walnut-admin-server/commit/6dc1008674cee2f4bf5c38ce1cc3acb17760a7b3))


### 📦 Misc

- Risk types ([20326d6](https://github.com/walnut-admin/walnut-admin-server/commit/20326d6f355a29d58953d8902bfd56d985a8da86))

- Types.d.ts ([1aca004](https://github.com/walnut-admin/walnut-admin-server/commit/1aca0048b0ce26a0d2e6f2ce16f97774e7e2c87d))


### 🔧 Refactor

- Role module ([2074868](https://github.com/walnut-admin/walnut-admin-server/commit/20748683fd03e531d25a812ff36dfb84529e66c8))

- Lang module ([38a64f9](https://github.com/walnut-admin/walnut-admin-server/commit/38a64f9fb8052e7790d9883d8c26627a8d87520d))

- Locale module ([4cdc934](https://github.com/walnut-admin/walnut-admin-server/commit/4cdc9344708a86e95b0329b7b47b900588317b60))

- Log auth module ([22b0a6d](https://github.com/walnut-admin/walnut-admin-server/commit/22b0a6d2f5955f8c49fa36f49d7da360eddc7cfb))

- Log operate module ([633bff3](https://github.com/walnut-admin/walnut-admin-server/commit/633bff3ef7e00fcfe68b758181ab23db5af07a3e))

- Repo rename ([fb9c8eb](https://github.com/walnut-admin/walnut-admin-server/commit/fb9c8eb6dd024dc027a2de58c3e84209d334ba74))

- Role/user repo rename ([99bdbfd](https://github.com/walnut-admin/walnut-admin-server/commit/99bdbfdb975ecbec09c1519c31354f56d30dabce))

- Basic repo usage ([b2ae1f5](https://github.com/walnut-admin/walnut-admin-server/commit/b2ae1f51402333382a8820f24897b1a55f594d6b))

- Deleted module ([668db3e](https://github.com/walnut-admin/walnut-admin-server/commit/668db3e3b1fdfecef5b46ec0cb4cdd70c83de98a))

- User module ([1763a0c](https://github.com/walnut-admin/walnut-admin-server/commit/1763a0c6d4c05385a587a683b025b2f192eaa6c9))

- User module ([4839e6c](https://github.com/walnut-admin/walnut-admin-server/commit/4839e6c2529b829fe6c6afabfdb8f520439b2390))

- Shared module do not import mongoose directly ([841fbf0](https://github.com/walnut-admin/walnut-admin-server/commit/841fbf044bdd15fb485ccf6da3b92631c82e4480))

- Menu module & remove permission module ([5a63faa](https://github.com/walnut-admin/walnut-admin-server/commit/5a63faa8ee9f2d693952a4a6611eb7a1ff2fdabf))

- Auth log & otp adaptor ([baac23a](https://github.com/walnut-admin/walnut-admin-server/commit/baac23a3b1751bb1a73e6630c172f1a1e11b2db7))

- Otp guard ([f463698](https://github.com/walnut-admin/walnut-admin-server/commit/f463698aedd4b5f7228eea6dee76ca3315bf64c1))

- Auth log optimise ([defaac0](https://github.com/walnut-admin/walnut-admin-server/commit/defaac0638c90ac93767179afc5dd5acfe6281c6))

- Provider & providerId only in oauth module ([6d389d3](https://github.com/walnut-admin/walnut-admin-server/commit/6d389d355d53289c826a27e243c070ab0824a72f))

- Remove user email/phone ([6992f61](https://github.com/walnut-admin/walnut-admin-server/commit/6992f61306dd95b211ea9a7195fe51c4493f8d52))

- Gitee module ([b3e85f8](https://github.com/walnut-admin/walnut-admin-server/commit/b3e85f8aaf538eb6c8d52269458374ee13ac9570))

- Github module ([1019142](https://github.com/walnut-admin/walnut-admin-server/commit/101914294dc445cda3ebf8d91dd0dd786b5f1dea))

- No more new this.model ([5d88b1a](https://github.com/walnut-admin/walnut-admin-server/commit/5d88b1a81bf2df40e4caf2670af5dd1f2bf71086))

- Ali sms support ([459a7bf](https://github.com/walnut-admin/walnut-admin-server/commit/459a7bfa0d15c75fbe9f43b783662ba5977a3b4f))

- Optimise user identity service ([e3b4797](https://github.com/walnut-admin/walnut-admin-server/commit/e3b479703e9d64bfa1e5b694693d326074e03ce2))

- Device id ([60336c4](https://github.com/walnut-admin/walnut-admin-server/commit/60336c4097e30261ecb4c661334e7be8463edd07))

- Agent.md & skill.md ([f886ff4](https://github.com/walnut-admin/walnut-admin-server/commit/f886ff405bb2b49b8c6fb083fab8230394350dbe))

- Config lib ([646fa25](https://github.com/walnut-admin/walnut-admin-server/commit/646fa2511be2e1db75b3347ab9dfedec132ec040))

- Db inject model/connection ([478867a](https://github.com/walnut-admin/walnut-admin-server/commit/478867a16b83c72d2b075268771bd41c00ca03f0))

- Db const & transaction ([233a5c7](https://github.com/walnut-admin/walnut-admin-server/commit/233a5c77aaae60a2d6350ca901ceb24c4621d487))

- Default font size 14 ([af07df3](https://github.com/walnut-admin/walnut-admin-server/commit/af07df394425fa94f8c513ec78aad313daef5d05))

- Permission const ([f21c317](https://github.com/walnut-admin/walnut-admin-server/commit/f21c317d878626f0a57a131826e1ab5bc9dabb88))

- Docker compose dev yml ([31eefd7](https://github.com/walnut-admin/walnut-admin-server/commit/31eefd7c6a3b7679a62754f4c2b9307c3200cce8))

- Const lib ([ebe5713](https://github.com/walnut-admin/walnut-admin-server/commit/ebe5713e093d8d2001cc64359e9af4c220e04e52))

- Utils const remove to lib const ([5818fd9](https://github.com/walnut-admin/walnut-admin-server/commit/5818fd9c8018ebcf19363f09948d0250bee2bb54))

- Types lib ([e4a716e](https://github.com/walnut-admin/walnut-admin-server/commit/e4a716e576ffb1a315f8e2d3eb72c56764dd262e))

- Pipe libs ([ae166f4](https://github.com/walnut-admin/walnut-admin-server/commit/ae166f44a24a0ab93a94fb425ed272c916fca7d7))

- Exception libs ([755cb52](https://github.com/walnut-admin/walnut-admin-server/commit/755cb529d3701533ba128cfebda8636f5b416698))

- Remove new: true for mongoose API ([60611c7](https://github.com/walnut-admin/walnut-admin-server/commit/60611c7c1ebdbd626b8fb2630f1c70c7b7599796))

- Context lib ([8e8997b](https://github.com/walnut-admin/walnut-admin-server/commit/8e8997b5bd1c66778890500ed3a0bb59ff078d07))

- Param/query decorator ([c631a36](https://github.com/walnut-admin/walnut-admin-server/commit/c631a36e7b9174ff4eb48ca3b4e5aaa4daddc9b5))

- Remove arctic comment ([b28df0e](https://github.com/walnut-admin/walnut-admin-server/commit/b28df0ec3858f72c04de4c022f9ac6c4d8ff173d))


### 🔩 Chores

- Kimi agent ([c3ea282](https://github.com/walnut-admin/walnut-admin-server/commit/c3ea28286b070b1fed1b6231c706dcf13b68f4f2))

- Kimi skill ([ba78359](https://github.com/walnut-admin/walnut-admin-server/commit/ba78359801e082d03e1b2fb246bf3665d2d624c4))

- Shared md ([0b14b8f](https://github.com/walnut-admin/walnut-admin-server/commit/0b14b8fd79191698e450408ad60b856d80e40b2f))

- Cleanup ([762445f](https://github.com/walnut-admin/walnut-admin-server/commit/762445fd02989a62aac58f4df550e498306a86c1))

- Cover release ([fc2023b](https://github.com/walnut-admin/walnut-admin-server/commit/fc2023be5a52c0caacdcfeacd1f87eb3143a6605))

- Nest cli env diff ([00ad51b](https://github.com/walnut-admin/walnut-admin-server/commit/00ad51bbad4c08d0a99dc2c9c7ca24332d25ff2c))

- Claude ([8a86548](https://github.com/walnut-admin/walnut-admin-server/commit/8a865488ad926a6fa3f6f047d9993fbc8813481b))

- Claude skills ([144eda8](https://github.com/walnut-admin/walnut-admin-server/commit/144eda87554a7010ab3ac6dcf6bb61dbe4b5239b))

- Claude skills ([4e37bb0](https://github.com/walnut-admin/walnut-admin-server/commit/4e37bb050876eec0ef7b4f666c6ad387181bb468))

- Use node modules ts ([10a067a](https://github.com/walnut-admin/walnut-admin-server/commit/10a067a5e33086527ed06fb390b72bdcdcb0d31a))

- Update tsconfig and relative ([fa4d224](https://github.com/walnut-admin/walnut-admin-server/commit/fa4d224abf242e0340926d9bad7abd6173ad5669))

- Update  deps ([53922e6](https://github.com/walnut-admin/walnut-admin-server/commit/53922e6e9ddf82336562a9d1f10968980879bfb7))

- Serve-icon type ([122efbb](https://github.com/walnut-admin/walnut-admin-server/commit/122efbb92981542ebb2a7b3bcccd2b6096e63676))

- Tsconfig ([ac6ff3b](https://github.com/walnut-admin/walnut-admin-server/commit/ac6ff3b1cfd0494c6d22bd81a4e86d8e049df2c8))

- New skill ([ab311fa](https://github.com/walnut-admin/walnut-admin-server/commit/ab311faad86723aa3d4dd77c90c486bcb8b5dbf6))

- Build libs concurrent ([25af994](https://github.com/walnut-admin/walnut-admin-server/commit/25af994ba80b554b81b4551449157e43903e0714))

- Remove .agents ([ce75f10](https://github.com/walnut-admin/walnut-admin-server/commit/ce75f10e8c02ec58214d4917230606877b28da97))


### 🚧 WIP

- Sensitive module ([55e0318](https://github.com/walnut-admin/walnut-admin-server/commit/55e03185b2b6b1cd2b43647fa4842eea5264758c))

- User identity module ([57263aa](https://github.com/walnut-admin/walnut-admin-server/commit/57263aa3876650b9842c30c67ca14b33071e03d1))

- User identity migrate ([66888fb](https://github.com/walnut-admin/walnut-admin-server/commit/66888fb09f7b6685da1ff4eee87419caebd5ee4c))

- User identity opaque migrate ([6d84ba4](https://github.com/walnut-admin/walnut-admin-server/commit/6d84ba45d83bbc38715185cb272f5ecd92b67848))

- Email module with user identity ([a494925](https://github.com/walnut-admin/walnut-admin-server/commit/a494925d7e275549e3aa78b88bab2fee3f91e9a2))

- User security center ([46ded93](https://github.com/walnut-admin/walnut-admin-server/commit/46ded9332b009c9d16d3a98f5e55e63f65a2d4b2))

- OTP security ([9066ddf](https://github.com/walnut-admin/walnut-admin-server/commit/9066ddfac2c2e7184b498c61710768f95e392aa2))

- Security permission guard ([28fac19](https://github.com/walnut-admin/walnut-admin-server/commit/28fac1925ded4349f9d922c583d16f8ba14d6c1c))

- Monorepo ([c29132a](https://github.com/walnut-admin/walnut-admin-server/commit/c29132a67f1c56d4bdc9cb3f0c2d655791ef5f8f))

- Response error meta support ([57a937e](https://github.com/walnut-admin/walnut-admin-server/commit/57a937eefd286df2312ef474260e6875c18f64f6))

- Utils ([2556915](https://github.com/walnut-admin/walnut-admin-server/commit/25569154cb0dba0c1732ced37e2c70e5bd17d54f))

- Decorator libs ([f0fb2d7](https://github.com/walnut-admin/walnut-admin-server/commit/f0fb2d7dac72abc84cdf20f59d05e2f69e2de255))

- Remove to swc ([ebbc020](https://github.com/walnut-admin/walnut-admin-server/commit/ebbc02013003f783e4fa9400f6208f07f1002763))
