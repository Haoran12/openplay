# runtime.yaml Schema

`runtime.yaml` 是世界目录的场景状态文件，存储当前场景的运行时数据。

## 文件位置

```
my-world/
├── openplay.json
├── runtime.yaml          ← 场景状态（热数据）
├── characters/
└── ...
```

## 完整结构

```yaml
current_scene:
  date: "1003-07-14"
  location: "今庭 - 荆州 - 云梦泽 - 建木府 - 主卧"
  impression: "夜间, 阴凉惬意的房间;"

present_characters:
  - name: "孟缘"
    age: 582
    appearance: "衣裳半解, 妩媚勾人"
    activity: "与宋祈交欢双修中"
    state: "情动, 被宋祈压在身下, 与丈夫灵力交融"
    body_condition: ["左臂旧伤未愈", "呼吸微乱"]
    carried_items: []
    worn_items: ["青色外衫", "玉佩"]
    restraints: []
    impairments: []
    sensed_effects: ["对屋内灵力波动格外敏感"]
  - name: "宋祈"
    age: 632
    appearance: "温柔霸道"
    activity: "与孟缘交欢双修中"
    state: "情动, 将孟缘压在身下, 与妻子灵力交融"

environment:
  inferred: true
  location: "云梦泽建木府主卧"
  time: "1003-07-14T20:30"
  time_of_day: "夜晚"
  season: "盛夏"
  weather:
    temperature: 27
    humidity: 72
    wind_speed: 3
    wind_direction: "东南"
  precipitation:
    type: null
    intensity: null
    accumulated: 0
  illumination:
    primary_source: "红烛"
    celestial_bodies:
      moon_phase: null
      stars_visible: true
    visibility_obstruction:
      clouds: 15
      fog: null
      dust: null
      smoke: null
    artificial_lights: []
    terrain_shadow: ""
  atmosphere:
    quality: "clear"
    special_particles: null
  magical_effects: []

narrative_style:
  language: "early_modern"
  rhetoric: "balanced"
  psychology: "mixed"
  pacing: "varied"
```

## 字段说明

### current_scene

当前场景的基本信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `date` | string | 游戏内日期（YYYY-MM-DD 格式） |
| `location` | string | 当前场景地点（层级路径） |
| `impression` | string | 场景氛围/印象描述 |

### present_characters

在场角色列表。每个角色包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 角色名 |
| `age` | number | 当前年龄 |
| `appearance` | string | 外观描述 |
| `activity` | string | 当前活动 |
| `state` | string | 身体/精神状态 |
| `body_condition` | string[] | 当前身体状况，如伤势、疲惫、发热、寒冷 |
| `carried_items` | string[] | 手持、背负、携带的物件 |
| `worn_items` | string[] | 穿戴中的衣物、饰品、装备 |
| `restraints` | string[] | 束缚、限制、封锁状态 |
| `impairments` | string[] | 明确的身体/感官受损，如遮眼、耳伤、跛行 |
| `sensed_effects` | string[] | 当前已确认的客观异常感知状态，如“对灵力波动格外敏感” |

角色状态通过 `scene_update` 工具更新。

说明：

- 旧世界仍可只使用 `appearance` / `activity` / `state` 文本字段。
- 新结构化字段是可选增强层，`embody` 会优先消费它们来生成角色的当前身体状态与有效感知状态。

### environment

环境信息，由 Director 根据场景推断。

| 字段 | 类型 | 说明 |
|------|------|------|
| `inferred` | boolean | 是否由 Director 推断 |
| `location` | string | 简化的位置名 |
| `time` | string | ISO 时间戳 |
| `time_of_day` | string | 时段：清晨/上午/中午/下午/傍晚/夜晚 |
| `season` | string | 季节 |
| `weather` | object | 天气详情 |
| `precipitation` | object | 降水详情 |
| `illumination` | object | 光照详情 |
| `atmosphere` | object | 空气质量 |
| `magical_effects` | array | 法术影响列表 |

说明：

- `embody` 会把 `environment` 视为角色的客观环境输入来源。
- `illumination`、`visibility_obstruction`、`atmosphere`、`magical_effects` 会参与推导角色当前的有效感知状态，例如视觉受阻、灵觉受扰、极端冷热导致注意力迟钝等。

#### weather 子字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `temperature` | number | 温度（摄氏度） |
| `humidity` | number | 湿度（百分比） |
| `wind_speed` | number | 风速（m/s） |
| `wind_direction` | string | 风向 |

#### precipitation 子字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string/null | 降水类型：rain/snow/hail/null |
| `intensity` | string/null | 强度：light/moderate/heavy |
| `accumulated` | number | 累积量（mm） |

#### illumination 子字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `primary_source` | string | 主要光源：sun/moon/红烛/等 |
| `celestial_bodies` | object | 天体信息 |
| `visibility_obstruction` | object | 能见度阻碍 |
| `artificial_lights` | array | 人工光源 |
| `terrain_shadow` | string | 地形阴影 |

### narrative_style

叙事风格配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| `language` | string | 语言风格：`modern`/`early_modern`/`classical` |
| `rhetoric` | string | 修辞风格：`minimal`/`balanced`/`ornate` |
| `psychology` | string | 心理描写：`internal`/`external`/`mixed` |
| `pacing` | string | 节奏：`steady`/`varied`/`accelerating` |

## 空模板

```yaml
current_scene:
  date: null
  location: null
  impression: null

present_characters: []

environment:
  inferred: false
  location: null
  time: null
  time_of_day: null
  season: null
  weather:
    temperature: null
    humidity: null
    wind_speed: null
    wind_direction: null
  precipitation:
    type: null
    intensity: null
    accumulated: 0
  illumination:
    primary_source: null
    celestial_bodies:
      moon_phase: null
      stars_visible: null
    visibility_obstruction:
      clouds: null
      fog: null
      dust: null
      smoke: null
    artificial_lights: []
    terrain_shadow: null
  atmosphere:
    quality: null
    special_particles: null
  magical_effects: []

narrative_style:
  language: "early_modern"
  rhetoric: "balanced"
  psychology: "mixed"
  pacing: "varied"
```

## 更新方式

Director Agent 使用 `scene_update` 工具更新此文件：

```
scene_update(
  path: "runtime.yaml",
  content: "完整的更新后 YAML 内容"
)
```

## 注意事项

- 此文件由 Director Agent 维护，玩家不应直接编辑
- 所有字段都是可选的，缺失字段由 Director 推断
- `present_characters` 中的角色名应与 `characters/` 目录中的角色文件对应
- `environment.inferred: true` 表示环境由 Director 推断，非玩家指定
