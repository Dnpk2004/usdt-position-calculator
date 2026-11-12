<script setup lang="ts">
defineProps<{ id: string; label: string; modelValue: string; suffix?: string; placeholder?: string; error?: string; optional?: boolean }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="field" :class="{ invalid: error }">
    <label :for="id">{{ label }} <span v-if="optional" class="optional">可选</span></label>
    <div class="input-wrap">
      <input :id="id" :value="modelValue" type="text" inputmode="decimal" :placeholder="placeholder ?? '请输入'"
        maxlength="96" autocomplete="off" spellcheck="false" :aria-invalid="!!error"
        :aria-describedby="error ? `${id}-error` : undefined"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
      <span v-if="suffix" class="suffix">{{ suffix }}</span>
    </div>
    <p v-if="error" :id="`${id}-error`" class="field-error">{{ error }}</p>
  </div>
</template>
