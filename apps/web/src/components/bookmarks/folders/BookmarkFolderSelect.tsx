import { useTranslation } from 'react-i18next'
import type { BookmarkFolderDTO } from '@tmarks/contracts'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { flattenFolders } from './folderTree'

const ROOT_FOLDER_VALUE = '__root__'

interface BookmarkFolderSelectProps {
  folders: BookmarkFolderDTO[]
  value: string | null
  onChange: (folderId: string | null) => void
  disabled?: boolean
}

/** 文件夹下拉选择(Radix Select),用 flattenFolders 带深度缩进展示树。 */
export function BookmarkFolderSelect({
  folders,
  value,
  onChange,
  disabled,
}: BookmarkFolderSelectProps) {
  const { t } = useTranslation('bookmarks')
  const options = flattenFolders(folders)
  const noFolderLabel = t('form.noFolder')

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium">{t('form.folder')}</label>
      <Select
        value={value ?? ROOT_FOLDER_VALUE}
        onValueChange={(val) => onChange(val === ROOT_FOLDER_VALUE ? null : val)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder={noFolderLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ROOT_FOLDER_VALUE}>{noFolderLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
