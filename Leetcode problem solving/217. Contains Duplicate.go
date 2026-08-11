//a go program array nums checks if any value shows more than one time.
//outputs true if same value more than once else false.
//make it 0ms runtime
func containsDuplicate(nums []int) bool {
    slices.Sort(nums)
    for i := 1; i < len(nums); i++ {
        if nums[i] == nums[i-1] {
            return true
        }
    }
    
    return false
}