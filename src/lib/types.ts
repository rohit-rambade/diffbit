export type Lang = 'json' | 'xml' | 'sql' | 'text'

export type Token = { text: string; cls: string; mark?: boolean }

export type ValidationError = { message: string; line: number; col: number }

export type FormatResult = { output: string; error: ValidationError | null }
