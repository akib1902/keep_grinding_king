class Solution:
    def anyFunction(self, nums: List[int], k: int) -> None:
        n=len(nums)
        for i in len(nums):
            if i+k > n:
                nums[(i+k)-n-1]=nums[i]
            else:
                nums[i+k] = nums[i]
        return nums