'use client'

interface ExplicitContentToggleProps {
  isAllowed: boolean
  onToggleChange: (isAllowed: boolean) => void
}

export function ExplicitContentToggle({
  isAllowed,
  onToggleChange
}: ExplicitContentToggleProps): JSX.Element {
  const handleToggle = (): void => {
    onToggleChange(!isAllowed)
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-medium'>Explicit Content</h3>
      </div>

      <div className='space-y-2'>
        <div className='flex items-center gap-4'>
          <div className='flex-1'>
            <label className='flex cursor-pointer items-center gap-3'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only'
                  checked={isAllowed}
                  onChange={handleToggle}
                />
                <div
                  className={`block h-6 w-11 rounded-full transition-colors duration-200 ${
                    isAllowed ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <div
                  className={`bg-white absolute left-1 top-1 h-4 w-4 rounded-full transition-transform duration-200 ${
                    isAllowed ? 'translate-x-5' : ''
                  }`}
                />
              </div>
              <span className='text-sm text-muted-foreground'>
                {isAllowed
                  ? 'Explicit content allowed'
                  : 'Explicit content filtered'}
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className='rounded-lg border bg-muted p-3 text-sm'>
        <p className='text-muted-foreground'>
          {isAllowed
            ? 'Explicit content will be included in track suggestions'
            : 'Explicit content will be filtered from track suggestions'}
        </p>
      </div>
    </div>
  )
}
