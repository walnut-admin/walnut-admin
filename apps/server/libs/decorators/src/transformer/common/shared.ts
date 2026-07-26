import { Transform } from 'class-transformer'
import { isNil } from 'lodash'

export function TransformToGHz(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 GHz'
    }

    return `${value} GHz`
  })
}

export function TransformSizeToGB(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 GB'
    }

    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
  })
}

export function TransformSizeToMB(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 MB'
    }

    return `${(value / 1024 / 1024).toFixed(2)} MB`
  })
}

export function TransformSizeToKB(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 KB'
    }

    return `${(value / 1024).toFixed(2)} KB`
  })
}

export function TransformToVoltage(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 V'
    }

    return `${value} V`
  })
}

export function TransformToMWH(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 mWh'
    }

    return `${value} mWh`
  })
}

export function TransformToPercentage(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 %'
    }

    return `${value} %`
  })
}

export function TransformToSeconds(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 s'
    }

    return `${value} s`
  })
}

export function TransformSecondsToHours(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 h'
    }

    return `${(value / 60 / 60).toFixed(2)} h`
  })
}

export function TransformMbitsToMBs(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 MB/s'
    }

    return `${(value / 8).toFixed(2)} MB/s`
  })
}

export function TransformToBytes(): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value)) {
      return '0 bytes'
    }

    return `${value} bytes`
  })
}
